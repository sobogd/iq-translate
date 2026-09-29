import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _CookieJarClient extends http.BaseClient {
  static const String _storageKey = 'cookies';

  final Map<String, String> _cookies = {};
  final http.Client _inner = IOClient();

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw == null) return;
    for (final part in raw.split('; ')) {
      final eq = part.indexOf('=');
      if (eq < 1) continue;
      _cookies[part.substring(0, eq)] = part.substring(eq + 1);
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _storageKey,
      _cookies.entries.map((e) => '${e.key}=${e.value}').join('; '),
    );
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (_cookies.isNotEmpty) {
      request.headers['cookie'] =
          _cookies.entries.map((e) => '${e.key}=${e.value}').join('; ');
    }
    final response = await _inner.send(request);
    final setCookies = response.headers['set-cookie'];
    if (setCookies != null) {
      for (final part in setCookies.split(',')) {
        final pair = part.split(';').first.trim();
        final eq = pair.indexOf('=');
        if (eq < 1) continue;
        final name = pair.substring(0, eq).trim();
        final value = pair.substring(eq + 1).trim();
        if (name.isEmpty || value.isEmpty) {
          _cookies.remove(name);
        } else {
          _cookies[name] = value;
        }
      }
      await _save();
    }
    return response;
  }

  @override
  void close() {
    _inner.close();
    super.close();
  }
}

final _cookieJar = _CookieJarClient();

http.Client makeApiClient() => _cookieJar;

Future<void> loadApiCookies() => _cookieJar.load();
