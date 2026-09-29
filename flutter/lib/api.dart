import 'dart:convert';

import 'package:http/http.dart' as http;

import 'client.dart';

class Turn {
  final String id;
  final String sourceLang;
  final String transcript;
  final String translation;

  const Turn({
    required this.id,
    required this.sourceLang,
    required this.transcript,
    required this.translation,
  });

  factory Turn.fromJson(Map<String, dynamic> json) => Turn(
        id: json['id'] as String? ?? '',
        sourceLang: json['sourceLang'] as String? ?? '',
        transcript: json['transcript'] as String? ?? '',
        translation: json['translation'] as String? ?? '',
      );
}

class Conversation {
  final String? id;
  final String sourceLang;
  final String targetLang;
  final String writeLang;
  final List<Turn> translations;

  const Conversation({
    this.id,
    required this.sourceLang,
    required this.targetLang,
    required this.writeLang,
    this.translations = const [],
  });

  factory Conversation.fromJson(Map<String, dynamic> json) => Conversation(
        id: json['id'] as String?,
        sourceLang: json['sourceLang'] as String,
        targetLang: json['targetLang'] as String,
        writeLang: json['writeLang'] as String,
        translations: (json['translations'] as List<dynamic>? ?? const [])
            .map((e) => Turn.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class ApiError implements Exception {
  final int status;
  final String code;

  const ApiError(this.status, this.code);
}

class SseFrame {
  final String event;
  final Map<String, dynamic> data;

  const SseFrame(this.event, this.data);
}

class SseError implements Exception {
  final int status;
  final String code;

  SseError(this.status, this.code);
}

class Api {
  static const String base = String.fromEnvironment(
    "API_BASE",
    defaultValue: "https://iq-translate.com",
  );

  static final Api instance = Api();

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool retry = true,
  }) async {
    final request = http.Request(method, Uri.parse('$base$path'))
      ..headers['content-type'] = 'application/json';
    if (body != null) request.body = jsonEncode(body);
    http.StreamedResponse streamed;
    try {
      streamed = await apiClient.send(request);
    } on http.ClientException {
      throw ApiError(0, 'network');
    }
    final text = await streamed.stream.bytesToString();
    switch (streamed.statusCode) {
      case 200:
        return jsonDecode(text) as Map<String, dynamic>;
      case 401:
        if (retry) return _send(method, path, body: body, retry: false);
        throw ApiError(401, 'unauthorized');
      default:
        String code = '';
        try {
          code = (jsonDecode(text)['error'] ?? '') as String;
        } catch (_) {}
        throw ApiError(streamed.statusCode, code);
    }
  }

  Future<Conversation> getConversation({
    required String source,
    required String target,
  }) async {
    final json = await _send(
      'GET',
      '/api/conversation?source=${Uri.encodeQueryComponent(source)}&target=${Uri.encodeQueryComponent(target)}',
    );
    return Conversation.fromJson(json);
  }

  Future<Conversation> createConversation({
    required String source,
    required String target,
    required String writeLang,
  }) async {
    final json = await _send(
      'POST',
      '/api/conversation',
      body: {
        'sourceLang': source,
        'targetLang': target,
        'writeLang': writeLang,
      },
    );
    return Conversation.fromJson(json);
  }

  Future<Conversation> setWriteLang(String id, String writeLang) async {
    final json = await _send(
      'PATCH',
      '/api/conversation/$id',
      body: {'writeLang': writeLang},
    );
    return Conversation.fromJson(json);
  }

  Future<void> clearConversation(String id) async {
    await _send('DELETE', '/api/conversation/$id');
  }

  Future<int> verifyTurnstile(String token) async {
    final json = await _send(
      'POST',
      '/api/turnstile/verify',
      body: {'token': token},
      retry: false,
    );
    final ttl = json['ttl'];
    return ttl is int ? ttl : 30 * 60;
  }

  Stream<SseFrame> translateStream({
    required String text,
    required String conversationId,
  }) async* {
    final request = http.Request('POST', Uri.parse('$base/api/translate'))
      ..headers['content-type'] = 'application/json'
      ..body = jsonEncode(
        {'text': text, 'conversationId': conversationId},
      );
    http.StreamedResponse streamed;
    try {
      streamed = await apiClient.send(request);
    } on http.ClientException {
      throw SseError(0, 'network');
    }
    if (streamed.statusCode != 200) {
      final text = await streamed.stream.bytesToString();
      String code = 'error';
      try {
        code = (jsonDecode(text)['error'] ?? 'error') as String;
      } catch (_) {}
      throw SseError(streamed.statusCode, code);
    }
    final decoder = const Utf8Decoder(allowMalformed: true);
    var buffer = '';
    await for (final chunk in streamed.stream.transform(decoder)) {
      buffer += chunk;
      while (true) {
        final sep = buffer.indexOf('\n\n');
        if (sep < 0) break;
        final frame = buffer.substring(0, sep);
        buffer = buffer.substring(sep + 2);
        var event = 'message';
        var data = '';
        for (final line in frame.split('\n')) {
          if (line.startsWith('event: ')) event = line.substring(7).trim();
          if (line.startsWith('data: ')) data += line.substring(6);
        }
        if (data.isEmpty) continue;
        try {
          yield SseFrame(event, jsonDecode(data) as Map<String, dynamic>);
        } catch (_) {}
      }
    }
  }
}
