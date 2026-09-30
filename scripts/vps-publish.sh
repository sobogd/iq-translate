#!/usr/bin/env bash
#
# Публикация нативных сборок (android / ios / macos) на диск VPS — один общий
# скрипт для всех трёх платформ, без S3. Артефакт кладётся рядом с веб-клиентом
# и отдаётся nginx по https://iq-translate.com/files/translator/<name>/
# (сам location — отдельная задача, здесь только диск).
#
# Работает НА VPS: workflow scp-ит артефакт и этот скрипт на сервер, затем
# ssh-выполняет его. Артефакт должен лежать в staging-директории платформы:
#   $VPS_FILES_ROOT/<name>/staging/<artifact-filename>
#
# Использование:
#   vps-publish.sh <name> <version> <version-code> <artifact-filename> [--force]
#     name              android | ios | macos
#     version           имя версии из pubspec.yaml (0.1.2, часть до «+»)
#     version-code      номер сборки из pubspec.yaml (3, часть после «+»)
#     artifact-filename имя файла, под которым публикуем (translator-release.apk и т.п.)
#     --force           публиковать, даже если номер сборки не больше опубликованного
#
# Что делает:
#   1. Считает sha256 и размер артефакта из staging.
#   2. Вёршен-гейт по номеру сборки: те же байты (тот же номер + тот же sha256) —
#      повторный запуск той же сборки, публикуем молча. Номер <= опубликованного —
#      отказ (иначе устройство не поставит сборку «назад»), кроме --force.
#   3. Атомарно ставит артефакт на место (mv из staging — переименование, читатель
#      никогда не увидит наполовину записанный файл) и атомарно переписывает
#      version.json (сборка во временный файл + mv).
#   4. version.json — то, что читает клиент (flutter/lib/update.dart):
#        { "version": "0.1.2", "url": "https://iq-translate.com/files/translator/<name>/<файл>" }
#      version сравнивается с текущей APP_VERSION, url — откуда скачивать.
#      Рядом лежит latest.json с номером/размером/sha256 — по ним работает вёршен-гейт.
#   5. Чистим старые артефакты: держим $KEEP последних, остальные удаляем.
#
# Переменные окружения (разумные дефолты):
#   VPS_FILES_ROOT   корень на диске, дефолт /var/www/translator-app/files/translator
#   VPS_PUBLIC_BASE  публичный префикс URL, дефолт https://iq-translate.com/files/translator
#   KEEP             сколько последних артефактов держать, дефолт 2
#
# ВАЖНО: корень должен быть стабильной реальной директорией, а НЕ внутри релизного
# дерева веба (.../releases/): веб-деплой (translator-app.yml) режет старые релизы,
# и артефакты внутри них пропадут. /var/www/translator-app — symlink, который веб
# переключает атомарно, поэтому дефолтный путь безопасен ТОЛЬКО если bootstrap
# создаст <корень> реальной директорией-соседом releases/. Скрипт предупреждает,
# если по realpath видит, что попал внутрь releases/.

set -euo pipefail

# --- аргументы ---------------------------------------------------------------
if [ "$#" -lt 4 ]; then
  echo "usage: vps-publish.sh <name> <version> <version-code> <artifact-filename> [--force]" >&2
  exit 2
fi
name="$1"; version="$2"; version_code="$3"; artifact="$4"; shift 4

force=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    *) echo "неизвестный флаг: $arg" >&2; exit 2 ;;
  esac
done

case "$name" in
  android|ios|macos) ;;
  *) echo "name: ожидалось android|ios|macos, получено '$name'" >&2; exit 2 ;;
esac
[ -n "$version" ] || { echo "version: пустой" >&2; exit 2; }
case "$version_code" in
  ''|*[!0-9]*) echo "version-code: ожидался целый номер, получено '$version_code'" >&2; exit 2 ;;
esac
[ "$version_code" -ge 1 ] || { echo "version-code: должен быть >= 1" >&2; exit 2; }
[ -n "$artifact" ] || { echo "artifact-filename: пустой" >&2; exit 2; }
case "$artifact" in
  */*|.|..) echo "artifact-filename: только имя файла, без путей ('$artifact')" >&2; exit 2 ;;
esac

# --- где храним --------------------------------------------------------------
files_root="${VPS_FILES_ROOT:-/var/www/translator-app/files/translator}"
public_base="${VPS_PUBLIC_BASE:-https://iq-translate.com/files/translator}"
keep="${KEEP:-2}"
public_base="${public_base%/}"   # хвостовой / убираем, чтобы URL был предсказуемым

dir="$files_root/$name"
staging="$dir/staging"
src="$staging/$artifact"
dest="$dir/$artifact"
version_json="$dir/version.json"
latest_json="$dir/latest.json"

[ -f "$src" ] || { echo "нет артефакта в staging: $src (workflow должен scp-ить его сюда)" >&2; exit 1; }

mkdir -p "$dir" "$staging"
# nginx работает под своим пользователем: гарантируем, что опубликованное читается,
# независимо от umask того, кто scp-ил артефакт.
chmod a+rx "$dir"
chmod a+r "$src"

# /var/www/translator-app — symlink, который веб-деплой режет: если по realpath мы
# внутри релизного дерева, артефакт исчезнет при следующем вебе. Громко предупреждаем.
real_dir="$(realpath "$dir" 2>/dev/null || readlink -f "$dir" 2>/dev/null || printf '%s' "$dir")"
case "$real_dir" in
  */releases/*)
    echo "ВНИМАНИЕ: $dir реально лежит в $real_dir (веб-релизы). Веб-деплой удалит" >&2
    echo "артефакты из releases/ — укажите VPS_FILES_ROOT на стабильную директорию." >&2
    ;;
esac

# --- метаданные сборки -------------------------------------------------------
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}
sha256="$(sha256_of "$src")"
size="$(wc -c < "$src" | tr -d ' ')"

echo "сборка: $name $version (номер $version_code), ${size} Б, sha256 ${sha256:0:16}…"

# --- вёршен-гейт -------------------------------------------------------------
# Номер читаем из latest.json. Если файла нет или в нём нет номера — считаем,
# что ничего не опубликовано (первая публикация).
cur_code=0
cur_sha=""
if [ -f "$latest_json" ]; then
  cur_code="$(sed -n 's/.*"versionCode"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$latest_json" | head -1)"
  cur_sha="$(sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' "$latest_json" | head -1)"
  cur_code="${cur_code:-0}"
  echo "опубликовано: номер ${cur_code}${cur_sha:+, sha256 ${cur_sha:0:16}…}"
fi

if [ "$cur_code" -ge 1 ]; then
  # Совсем те же байты — повторный запуск той же сборки: делать нечего.
  if [ "$cur_code" -eq "$version_code" ] && [ "$cur_sha" = "$sha256" ]; then
    echo "эта сборка уже в релизе — публиковать нечего"
    rm -rf "$staging"
    exit 0
  fi
  # Номер <= опубликованного: устройство не поставит сборку «назад».
  if [ "$version_code" -le "$cur_code" ]; then
    if [ "$force" -ne 1 ]; then
      echo "в релизе уже номер $cur_code: поднимите version в flutter/pubspec.yaml," >&2
      echo "иначе устройство не увидит обновление (или передайте --force)" >&2
      exit 1
    fi
    echo "--force: публикую номер $version_code поверх $cur_code" >&2
  fi
fi

# --- атомарная публикация ----------------------------------------------------
# Сначала собираем оба JSON во временных файлах и только потом переключаем:
# ни артефакт, ни метаданные не остаются в наполовину обновлённом состоянии.
url="$public_base/$name/$artifact"
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

tmp_version="$version_json.tmp.$$"
tmp_latest="$latest_json.tmp.$$"
trap 'rm -f "$tmp_version" "$tmp_latest" 2>/dev/null' EXIT

# version.json — минимальный контракт клиента (flutter/lib/update.dart): version
# сравнивается с APP_VERSION, url — откуда скачивать. Лишние поля клиент игнорирует,
# но держим только то, что он реально использует.
printf '{\n  "version": "%s",\n  "url": "%s"\n}\n' "$version" "$url" > "$tmp_version"

# latest.json — метаданные для вёршен-гейта и отладки (аналог latest.json у cloudlyru).
{
  printf '{\n'
  printf '  "version": "%s",\n' "$version"
  printf '  "versionCode": %s,\n' "$version_code"
  printf '  "size": %s,\n' "$size"
  printf '  "sha256": "%s",\n' "$sha256"
  printf '  "builtAt": "%s",\n' "$built_at"
  printf '  "url": "%s"\n' "$url"
  printf '}\n'
} > "$tmp_latest"

# mv внутри одной ФС = переименование: файл на месте всегда целый, читатель
# никогда не увидит наполовину записанный артефакт.
mv -f "$src" "$dest"
mv -f "$tmp_version" "$version_json"
mv -f "$tmp_latest" "$latest_json"
chmod a+r "$dest" "$version_json" "$latest_json"
trap - EXIT

# --- чистка старых артефактов ------------------------------------------------
# Держим $keep последних (по времени изменения), остальные удаляем. version.json
# и latest.json не трогаем. Текущий артефакт — самый свежий, всегда остаётся.
cd "$dir"
# ls -1t — по времени изменения, свежий первым; -p помечает директории. case
# отфильтрует директории и метаданные (grep мог бы завершиться с ошибкой, если
# совпадений нет, а под set -e это убило бы скрипт).
ls -1tp | while read -r entry; do
  case "$entry" in
    */|version.json|version.json.*|latest.json|latest.json.*) continue ;;
    *) printf '%s\n' "$entry" ;;
  esac
done | tail -n +"$((keep + 1))" | while read -r f; do
  rm -f -- "$f"
done

rm -rf "$staging"

echo "опубликовано: $name $version (номер $version_code)"
echo "version.json: $version_json"
echo "артефакт: $url"
