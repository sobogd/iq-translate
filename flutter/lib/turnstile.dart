import 'dart:async';


import 'package:flutter/widgets.dart';

import 'api.dart';
import 'turnstile_backend.dart';
import 'turnstile_native.dart'
    if (dart.library.js_interop) 'turnstile_web.dart';

class TurnstileGate extends ChangeNotifier {
  static const String siteKey = String.fromEnvironment('TS_SITE');

  final TurnstileBackend _backend = makeTurnstileBackend();

  bool interactive = false;
  bool _passHeld = false;
  bool _solving = false;

  bool get ready => siteKey.isNotEmpty;

  bool get solving => _solving;

  Widget? get embed => interactive ? _backend.embed() : null;

  Future<bool> ensurePass() async {
    if (!ready) return false;
    if (_passHeld) return true;
    if (_solving) return false;
    _solving = true;
    interactive = true;
    notifyListeners();
    // The overlay (and the platform view inside it) must be mounted before the
    // widget is asked to solve, so wait for the frame that added it.
    await WidgetsBinding.instance.endOfFrame;
    String? token;
    try {
      token = await _backend.solve();
    } on Object {
      token = null;
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

  void cancel() {
    if (!_solving) return;
    _backend.cancel();
  }

  @override
  void dispose() {
    _backend.dispose();
    super.dispose();
  }
}
