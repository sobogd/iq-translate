import 'package:flutter/widgets.dart';

abstract class TurnstileBackend {
  Widget embed();

  Future<String?> solve();

  void cancel();

  void dispose();
}
