import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:http/http.dart' as http;

import 'api.dart';
import 'client.dart';

class _UpdateInfo {
  final String version;
  final String url;

  _UpdateInfo({required this.version, required this.url});
}

Future<void> checkForUpdate(BuildContext context) async {
  const current = String.fromEnvironment('APP_VERSION');
  if (kIsWeb || current.isEmpty) return;
  final name = switch (defaultTargetPlatform) {
    TargetPlatform.android => 'android',
    TargetPlatform.macOS => 'macos',
    TargetPlatform.iOS => 'ios',
    _ => null,
  };
  if (name == null || !context.mounted) return;
  final uri =
      Uri.parse('${Api.base}files/translator/$name/version.json');
  try {
    final request = http.Request('GET', uri);
    final response = await apiClient.send(request);
    final body = await response.stream.bytesToString();
    if (response.statusCode != 200) return;
    final map = jsonDecode(body) as Map<String, dynamic>;
    final info = _UpdateInfo(
      version: map['version'] as String? ?? '',
      url: map['url'] as String? ?? '',
    );
    if (info.version.isEmpty || info.url.isEmpty || !_isNewer(info.version, current)) {
      return;
    }
    if (!context.mounted) return;
    final decision = await _confirm(context, info);
    if (decision && context.mounted) {
      await launchUrl(Uri.parse(info.url), mode: LaunchMode.externalApplication);
    }
  } on Object {
    return;
  }
}

bool _isNewer(String latest, String current) {
  final a = latest.split('.').map((part) => int.tryParse(part) ?? 0).toList();
  final b = current.split('.').map((part) => int.tryParse(part) ?? 0).toList();
  for (var i = 0; i < 3; i++) {
    final x = i < a.length ? a[i] : 0;
    final y = i < b.length ? b[i] : 0;
    if (x != y) return x > y;
  }
  return false;
}

Future<bool> _confirm(BuildContext context, _UpdateInfo info) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) {
      return AlertDialog(
        title: const Text('Доступна новая версия'),
        content:
            Text('Есть версия ${info.version}. Скачать и установить?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Позже'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Скачать'),
          ),
        ],
      );
    },
  );
  return result ?? false;
}
