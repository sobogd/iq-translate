import 'dart:async';
import 'dart:ui' show Brightness, Color, PlatformDispatcher;

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'api.dart';
import 'turnstile_backend.dart';

class _NativeTurnstile implements TurnstileBackend {
  static const String _scheme = 'iqtranslate';

  final WebViewController _controller = WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..setBackgroundColor(_background);
  Completer<String?>? _pending;

  static Color get _background =>
      PlatformDispatcher.instance.platformBrightness == Brightness.dark
          ? const Color(0xFF1e1f23)
          : Colors.white;

  _NativeTurnstile() {
    _controller.setNavigationDelegate(NavigationDelegate(
      onNavigationRequest: (request) {
        final url = request.url;
        if (url.startsWith('$_scheme://')) {
          final token = Uri.tryParse(url)?.queryParameters['token'];
          _finish(token);
          return NavigationDecision.prevent;
        }
        return NavigationDecision.navigate;
      },
    ));
  }

  @override
  Widget embed() => WebViewWidget(controller: _controller);

  @override
  Future<String?> solve() async {
    await _controller.loadRequest(Uri.parse('${Api.base}t/?app=1'));
    final completer = Completer<String?>();
    _pending = completer;
    return completer.future;
  }

  void _finish(String? token) {
    final pending = _pending;
    _pending = null;
    if (pending != null && !pending.isCompleted) pending.complete(token);
  }

  @override
  void cancel() {
    _finish(null);
    _controller.loadRequest(Uri.parse('about:blank'));
  }

  @override
  void dispose() => cancel();
}

TurnstileBackend makeTurnstileBackend() => _NativeTurnstile();
