import 'package:http/http.dart' as http;

import 'client_native.dart'
    if (dart.library.js_interop) 'client_web.dart';

final http.Client apiClient = makeApiClient();

Future<void> initApiCookies() => loadApiCookies();
