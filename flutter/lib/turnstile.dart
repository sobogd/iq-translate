import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'turnstile_backend.dart';
import 'turnstile_native.dart'
    if (dart.library.js_interop) 'turnstile_web.dart';

class TurnstileGate extends ChangeNotifier implements TurnstileWidgetHost {
  static const String siteKey = String.fromEnvironment('TS_SITE');

  final TurnstileBackend _backend;

  TurnstileGate() : _backend = makeTurnstileBackend() {
    _backend.setHost(this);
  }

  bool interactive = false;
  bool _passHeld = false;
  bool _solving = false;

  bool get _ready => kIsWeb && siteKey.isNotEmpty;

  Future<bool> ensurePass() async {
    if (!_ready) return false;
    if (_passHeld) return true;
    if (_solving) return false;
    _solving = true;
    interactive = true;
    notifyListeners();
    String? token;
    try {
      token = await _backend.solve();
    } finally {
      _solving = false;
    }
    interactive = false;
    notifyListeners();
    if (token == null) return false;
    try {
      await Api.instance.verifyTurnstile(token);
    } on ApiError {
      return false;
    }
    _passHeld = true;
    return true;
  }

  void invalidatePass() {
    _passHeld = false;
  }

  @override
  void beforeInteractive() {
    interactive = true;
    notifyListeners();
  }

  @override
  void afterInteractive() {
    if (!_solving) {
      interactive = false;
      notifyListeners();
    }
  }

  void attachContainer(Object element) => _backend.attach(element);
}
