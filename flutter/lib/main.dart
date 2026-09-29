import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';

import 'api.dart';
import 'client.dart';
import 'languages.dart';
import 'turnstile.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initApiCookies();
  final gate = TurnstileGate();
  runApp(IqTranslateApp(gate: gate));
}

class IqTranslateApp extends StatelessWidget {
  final TurnstileGate gate;

  const IqTranslateApp({super.key, required this.gate});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Iq Translate',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF3B5BDB),
          brightness: Brightness.dark,
        ),
      ),
      home: HomeScreen(gate: gate),
    );
  }
}

class _PendingTurn {
  String transcript;
  String translation = '';

  _PendingTurn(this.transcript);
}

class HomeScreen extends StatefulWidget {
  final TurnstileGate gate;

  const HomeScreen({super.key, required this.gate});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String source = 'ru';
  String target = 'en';
  Conversation? conversation;
  final List<Turn> turns = [];
  _PendingTurn? pending;
  bool sending = false;
  final _input = TextEditingController();
  final _scroll = ScrollController();
  StreamSubscription? _subscription;

  TurnstileGate get gate => widget.gate;

  @override
  void initState() {
    super.initState();
    gate.addListener(_notify);
    _boot();
  }

  void _notify() {
    if (mounted) setState(() {});
  }

  Future<void> _boot() async {
    await languages.load();
    await _loadConversation();
  }

  Future<void> _loadConversation() async {
    if (!languages.loaded) return;
    Conversation next;
    try {
      next = await Api.instance.getConversation(source: source, target: target);
    } on Object {
      next = Conversation(
        id: null,
        sourceLang: source,
        targetLang: target,
        writeLang: source,
      );
    }
    if (!mounted) return;
    final loaded = next;
    setState(() {
      conversation = loaded;
      turns
        ..clear()
        ..addAll(loaded.translations.reversed);
    });
  }

  void _selectPair(String source, String target) {
    setState(() {
      this.source = source;
      this.target = target;
      conversation = null;
      turns.clear();
    });
    _loadConversation();
  }

  void _swap() {
    if (source == target) return;
    final old = source;
    setState(() {
      source = target;
      target = old;
    });
    final id = conversation?.id;
    if (id != null && conversation!.writeLang != source) {
      Api.instance
          .setWriteLang(id, source)
          .then((updated) {
        if (!mounted) return;
        setState(() => conversation = updated);
      }).catchError((_) {});
    } else {
      _loadConversation();
    }
  }

  Future<void> _clear() async {
    final id = conversation?.id;
    if (id == null) return;
    try {
      await Api.instance.clearConversation(id);
      await _loadConversation();
    } on ApiError catch (e) {
      _snack(e.code);
    }
  }

  void _snack(String code) {
    if (!mounted) return;
    final message = switch (code) {
      'rate_limited' => 'Слишком часто — подождите немного',
      'too_long' => 'Текст длиннее 256 килобайт',
      'turnstile_failed' => 'Проверка не прошла, попробуйте ещё раз',
      'unknown_language' => 'Неизвестный язык',
      'network' => 'Нет сети',
      _ => code,
    };
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<bool> _ensurePass() async {
    final ok = await gate.ensurePass();
    if (mounted) setState(() {});
    return ok;
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || sending || conversation == null) return;
    var convo = conversation!;
    if (convo.id == null) {
      try {
        convo = await Api.instance.createConversation(
          source: source,
          target: target,
          writeLang: source,
        );
      } on ApiError catch (e) {
        _snack(e.code);
        return;
      }
      if (!mounted) return;
      setState(() => conversation = convo);
    }
    await _translate(text, convo);
  }

  Future<void> _translate(String text, Conversation convo) async {
    setState(() {
      sending = true;
      pending = _PendingTurn(text);
    });
    _input.clear();
    _scrollToBottom();
    _subscription?.cancel();
    final stream = Api.instance.translateStream(
      text: text,
      conversationId: convo.id ?? '',
    );
    SseError? failure;
    final subscription = stream.listen(
      _onFrame,
      onError: (Object error) {
        failure = error is SseError ? error : SseError(500, 'error');
      },
    );
    _subscription = subscription;
    try {
      await subscription.asFuture<void>();
    } on SseError catch (e) {
      failure = e;
    } on Object {
      failure = SseError(500, 'error');
    }
    final failed = failure;
    if (failed != null && failed.status == 403) {
      gate.invalidatePass();
      final ok = await _ensurePass();
      if (!ok) {
        _failPending();
        _snack('turnstile_failed');
        return;
      }
      await _translate(text, convo);
      return;
    }
    if (failed != null && failed.code != 'rate_limited') {
      _snack(failed.code.isNotEmpty ? failed.code : 'api_error');
    }
    _failPending();
  }

  void _onFrame(SseFrame frame) {
    if (!mounted) return;
    final data = frame.data;
    switch (frame.event) {
      case 'transcript':
        pending?.transcript = (data['text'] as String? ?? '').isNotEmpty
            ? data['text'] as String
            : pending?.transcript ?? '';
        _notify();
      case 'delta':
        final delta = data['text'] as String? ?? '';
        if (pending != null && delta.isNotEmpty) {
          pending!.translation += delta;
        }
        _notify();
        _scrollToBottom();
      case 'done':
        final turn = Turn.fromJson(data);
        _notify();
        turns.add(
          Turn(
            id: turn.id.isEmpty
                ? DateTime.now().microsecondsSinceEpoch.toString()
                : turn.id,
            sourceLang:
                turn.sourceLang.isEmpty ? conversation?.writeLang ?? source : turn.sourceLang,
            transcript: turn.transcript,
            translation: turn.translation,
          ),
        );
        pending = null;
        sending = false;
        _notify();
        _scrollToBottom();
      case 'error':
        _snack((data['code'] as String? ?? 'error') == 'error'
            ? 'rate_limited'
            : data['code'] as String? ?? 'error');
        _failPending();
    }
  }

  void _failPending() {
    if (pending != null || sending) {
      pending = null;
      sending = false;
      _notify();
    }
  }

  void _scrollToBottom() {
    if (!mounted || !_scroll.hasClients) return;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  void dispose() {
    gate.removeListener(_notify);
    _subscription?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Stack(
      children: [
        Scaffold(
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: _pairPicker(
                          value: source,
                          other: target,
                          onSelected: (code) => _selectPair(code, target),
                        ),
                      ),
                      const SizedBox(width: 10),
                      IconButton(onPressed: _swap, icon: const Icon(Icons.swap_horiz)),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _pairPicker(
                          value: target,
                          other: source,
                          onSelected: (code) => _selectPair(source, code),
                        ),
                      ),
                      const SizedBox(width: 10),
                      if (turns.isNotEmpty)
                        IconButton(
                          onPressed: _clear,
                          icon: const Icon(Icons.delete_outline),
                        ),
                    ],
                  ),
                  Expanded(
                    child: turns.isEmpty && pending == null
                        ? Center(
                            child: Text(
                              'Переведите что-нибудь',
                              style: Theme.of(context).textTheme.bodyMedium
                                  ?.copyWith(color: scheme.onSurfaceVariant),
                            ),
                          )
                        : ListView.builder(
                            controller: _scroll,
                            reverse: true,
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            itemCount: turns.length + (pending == null ? 0 : 1),
                            itemBuilder: (context, index) {
                              if (pending != null && index == 0) {
                                return _bubble(
                                  pending!.transcript,
                                  pending!.translation,
                                  userSide: true,
                                );
                              }
                              final turn = turns[turns.length - 1 - index];
                              return _bubble(
                                turn.transcript,
                                turn.translation,
                                userSide: turn.sourceLang == conversation?.writeLang,
                              );
                            },
                          ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _input,
                          enabled: !sending,
                          maxLines: null,
                          decoration: InputDecoration(
                            hintText: 'Текст для перевода',
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          onSubmitted: sending ? null : (_) => _send(),
                        ),
                      ),
                      const SizedBox(width: 10),
                      IconButton.filled(
                        onPressed:
                            sending || _input.text.trim().isEmpty ? null : _send,
                        icon: sending
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.arrow_upward),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
        if (gate.interactive)
          _TurnstileOverlay(gate: gate),
      ],
    );
  }

  Widget _pairPicker({
    required String value,
    required String other,
    required void Function(String) onSelected,
  }) {
    return DropdownButtonHideUnderline(
      child: InputDecorator(
        decoration: const InputDecoration(
          border: OutlineInputBorder(),
          isDense: true,
        ),
        child: DropdownButton<String>(
          value: languages.loaded ? value : null,
          isExpanded: true,
          items: languages.all
              .where((l) => l.code != other)
              .map((l) => DropdownMenuItem(
                    value: l.code,
                    child: Text('${l.flag} ${l.nameRu}',
                        overflow: TextOverflow.ellipsis),
                  ))
              .toList(),
          onChanged: languages.loaded
              ? (code) {
                  if (code != null) onSelected(code);
                }
              : null,
        ),
      ),
    );
  }

  Widget _bubble(
    String transcript,
    String translation, {
    required bool userSide,
  }) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final alignment = userSide ? Alignment.centerRight : Alignment.centerLeft;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: alignment,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              constraints: const BoxConstraints(maxWidth: 480),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Text(transcript, style: theme.textTheme.bodyLarge),
            ),
          ),
          if (translation.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Align(
                alignment: alignment,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                  constraints: const BoxConstraints(maxWidth: 480),
                  decoration: BoxDecoration(
                    color: scheme.primaryContainer.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Text(translation, style: theme.textTheme.bodyLarge),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _TurnstileOverlay extends StatelessWidget {
  final TurnstileGate gate;

  const _TurnstileOverlay({required this.gate});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return IgnorePointer(
      ignoring: false,
      child: Stack(
        children: [
          Positioned.fill(child: ColoredBox(color: Colors.black.withValues(alpha: 0.5))),
          Center(
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: scheme.surface,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: scheme.outline),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Подтвердите, что вы человек'),
                  const SizedBox(height: 12),
                  if (kIsWeb)
                    HtmlElementView.fromTagName(
                      tagName: 'div',
                      hitTestBehavior: PlatformViewHitTestBehavior.opaque,
                      onElementCreated: gate.attachContainer,
                    )
                  else
                    const Text('Недоступно в этой версии'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
