abstract class TurnstileBackend {
  void setHost(TurnstileWidgetHost host);
  Future<String?> solve();
  void attach(Object? element);
}

abstract class TurnstileWidgetHost {
  void beforeInteractive();
  void afterInteractive();
}
