import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'turnstile_backend.dart';

class _WebTurnstile implements TurnstileBackend {
  static const String siteKey = String.fromEnvironment('TS_SITE');
  static const String _scriptId = 'cf-turnstile-script';
  static const String _scriptSrc =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  TurnstileWidgetHost? _host;
  bool _scriptLoaded = false;
  String _widgetId = '';
  JSObject? _container;

  @override
  void setHost(TurnstileWidgetHost host) {
    _host = host;
  }

  @override
  void attach(Object? element) {
    _container = element as JSObject?;
  }

  @override
  Future<String?> solve() async {
    await _loadScript();
    if (!_scriptLoaded) return null;
    final turnstile = globalContext['turnstile'] as JSObject?;
    final container = _container;
    if (turnstile == null || container == null) return null;
    if (_widgetId.isNotEmpty && !identical(_container, container)) {
      try {
        turnstile.callMethod<JSAny>('removeWidget'.toJS, _widgetId.toJS);
      } catch (_) {}
      _widgetId = '';
    }
    final completer = Completer<String?>();
    final onCallback = ((JSString? token) {
      if (!completer.isCompleted) completer.complete(token?.toDart);
    }).toJS;
    final onFail = ((JSAny? _) {
      if (!completer.isCompleted) completer.complete(null);
    }).toJS;
    final onBefore = ((JSAny? _) => _host?.beforeInteractive()).toJS;
    final onAfter = ((JSAny? _) => _host?.afterInteractive()).toJS;
    final options = JSObject()
      ..setProperty('sitekey'.toJS, siteKey.toJS)
      ..setProperty('execution'.toJS, 'execute'.toJS)
      ..setProperty('appearance'.toJS, 'interaction-only'.toJS)
      ..setProperty('theme'.toJS, 'light'.toJS)
      ..setProperty('callback'.toJS, onCallback)
      ..setProperty('error-callback'.toJS, onFail)
      ..setProperty('timeout-callback'.toJS, onFail)
      ..setProperty('expired-callback'.toJS, onFail)
      ..setProperty('before-interactive-callback'.toJS, onBefore)
      ..setProperty('after-interactive-callback'.toJS, onAfter);
    try {
      if (_widgetId.isEmpty) {
        final id = turnstile
            .callMethod<JSString>('render'.toJS, container, options)
            .toDart;
        if (id.isEmpty) return null;
        _widgetId = id;
      } else {
        turnstile.callMethod<JSAny>('reset'.toJS, _widgetId.toJS);
      }
      turnstile.callMethod<JSAny>('execute'.toJS, _widgetId.toJS);
    } catch (_) {
      return null;
    }
    return completer.future;
  }

  Future<void> _loadScript() async {
    if (globalContext['turnstile'] != null) {
      _scriptLoaded = true;
      return;
    }
    final document = globalContext['document'] as JSObject;
    JSObject? script =
        document.callMethod<JSAny?>('getElementById'.toJS, _scriptId.toJS)
            as JSObject?;
    if (script == null) {
      script = document
          .callMethod<JSObject>('createElement'.toJS, 'script'.toJS)
        ..setProperty('id'.toJS, _scriptId.toJS)
        ..setProperty('src'.toJS, _scriptSrc.toJS)
        ..setProperty('async'.toJS, true.toJS);
      document.callMethod<JSAny?>('appendChild'.toJS, script);
    }
    final completer = Completer<void>();
    script.setProperty('onload'.toJS,
        ((JSAny? _) => completer.complete()).toJS);
    await completer.future
        .timeout(const Duration(seconds: 10), onTimeout: () {});
    _scriptLoaded = globalContext['turnstile'] != null;
  }
}

TurnstileBackend makeTurnstileBackend() => _WebTurnstile();
