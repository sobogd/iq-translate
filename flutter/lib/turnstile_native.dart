import 'dart:async';

import 'turnstile_backend.dart';

class _NoopBackend implements TurnstileBackend {
  @override
  void setHost(TurnstileWidgetHost host) {}

  @override
  Future<String?> solve() async => null;

  @override
  void attach(Object? element) {}
}

TurnstileBackend makeTurnstileBackend() => _NoopBackend();
