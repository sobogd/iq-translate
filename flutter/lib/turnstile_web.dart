import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import 'turnstile_backend.dart';

class _WebTurnstile implements TurnstileBackend {
  static const String siteKey = String.fromEnvironment('TS_SITE');
  static const String _scriptId = 'cf-turnstile-script';
  static const String _scriptSrc =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  bool _scriptLoaded = false;
  JSObject? _container;
  String _widgetId = '';
  Completer<JSObject>? _attached;
  Completer<String?>? _pending;

  @override
  Widget embed() {
    return HtmlElementView.fromTagName(
      key: const ValueKey('cf-turnstile'),
      tagName: 'div',
      isVisible: true,
      hitTestBehavior: PlatformViewHitTestBehavior.opaque,
      onElementCreated: (element) => _onElementCreated(element as JSObject?),
    );
  }

  void _onElementCreated(JSObject? element) {
    final oldWidget = _widgetId;
    final oldContainer = _container;
    _widgetId = '';
    _container = element;
    if (element != null && oldWidget.isNotEmpty && !identical(element, oldContainer)) {
      final turnstile = globalContext['turnstile'] as JSObject?;
      try {
        turnstile?.callMethod<JSAny>('removeWidget'.toJS, oldWidget.toJS);
      } catch (_) {}
    }
    final attached = _attached;
    if (attached != null && !attached.isCompleted && element != null) {
      attached.complete(element);
    }
  }

  @override
  Future<String?> solve() async {
    await _loadScript();
    if (!_scriptLoaded) return null;
    final turnstile = globalContext['turnstile'] as JSObject?;
    if (turnstile == null) return null;
    if (_container == null) {
      final attached = Completer<JSObject>();
      _attached = attached;
      try {
        _container = await attached.future.timeout(const Duration(seconds: 5));
      } on TimeoutException {
        return null;
      }
    }
    var container = _container;
    if (container?['isConnected']?.dartify() != true) {
      final attached = Completer<JSObject>();
      _attached = attached;
      try {
        container = await attached.future.timeout(const Duration(seconds: 5));
      } on TimeoutException {
        return null;
      }
    }
    if (container == null) return null;
    final completer = Completer<String?>();
    _pending = completer;
    final onCallback = ((JSString? token) {
      _pending = null;
      if (!completer.isCompleted) completer.complete(token?.toDart);
    }).toJS;
    final onFail = ((JSAny? _) {
      _pending = null;
      if (!completer.isCompleted) completer.complete(null);
    }).toJS;
    final options = JSObject()
      ..setProperty('sitekey'.toJS, siteKey.toJS)
      ..setProperty('execution'.toJS, 'execute'.toJS)
      ..setProperty('appearance'.toJS, 'interaction-only'.toJS)
      ..setProperty('theme'.toJS,
          PlatformDispatcher.instance.platformBrightness == Brightness.dark
              ? 'dark'.toJS
              : 'light'.toJS)
      ..setProperty('callback'.toJS, onCallback)
      ..setProperty('error-callback'.toJS, onFail)
      ..setProperty('timeout-callback'.toJS, onFail)
      ..setProperty('expired-callback'.toJS, onFail);
    try {
      if (_widgetId.isNotEmpty) {
        turnstile.callMethod<JSAny>('removeWidget'.toJS, _widgetId.toJS);
      }
      _widgetId = turnstile
          .callMethod<JSString>('render'.toJS, container, options)
          .toDart;
      if (_widgetId.isEmpty) return null;
      turnstile.callMethod<JSAny>('execute'.toJS, _widgetId.toJS);
    } catch (_) {
      _pending = null;
      return null;
    }
    return completer.future;
  }

  @override
  void cancel() {
    final turnstile = globalContext['turnstile'] as JSObject?;
    if (_widgetId.isNotEmpty) {
      try {
        turnstile?.callMethod<JSAny>('removeWidget'.toJS, _widgetId.toJS);
      } catch (_) {}
      _widgetId = '';
    }
    _container = null;
    final pending = _pending;
    _pending = null;
    if (pending != null && !pending.isCompleted) pending.complete(null);
  }

  @override
  void dispose() => cancel();

  Future<void> _loadScript() async {
    if (globalContext['turnstile'] != null) {
      _scriptLoaded = true;
      return;
    }
    final document = globalContext['document'] as JSObject;
    JSObject? script = document
        .callMethod<JSAny?>('getElementById'.toJS, _scriptId.toJS) as JSObject?;
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
