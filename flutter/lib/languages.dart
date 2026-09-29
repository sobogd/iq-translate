import 'dart:convert';
import 'package:flutter/services.dart' show rootBundle;

class Language {
  final String code;
  final String nameRu;
  final String nameNative;
  final String flag;

  const Language({
    required this.code,
    required this.nameRu,
    required this.nameNative,
    required this.flag,
  });

  factory Language.fromJson(Map<String, dynamic> json) => Language(
        code: json['code'] as String,
        nameRu: json['nameRu'] as String,
        nameNative: json['nameNative'] as String,
        flag: json['flag'] as String,
      );
}

class Languages {
  List<Language> all = [];
  Map<String, Language> byCode = {};
  bool loaded = false;

  Future<void> load() async {
    if (loaded) return;
    final raw = await rootBundle.loadString('assets/languages.json');
    all = (jsonDecode(raw) as List<dynamic>)
        .map((e) => Language.fromJson(e as Map<String, dynamic>))
        .toList();
    byCode = {for (final l in all) l.code: l};
    loaded = true;
  }
}

final Languages languages = Languages();
