import 'package:http/browser_client.dart';
import 'package:http/http.dart' as http;

http.Client makeApiClient() => BrowserClient();

Future<void> loadApiCookies() async {}
