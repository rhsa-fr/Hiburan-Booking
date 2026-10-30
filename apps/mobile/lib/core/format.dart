const _months = <String>[
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

String _group(int value) {
  final digits = value.toString();
  final out = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write('.');
    out.write(digits[i]);
  }
  return out.toString();
}

/// `1500000` → `Rp 1.500.000`. Integer rupiah everywhere, never a double.
String rupiah(int amount) =>
    amount < 0 ? '-Rp ${_group(-amount)}' : 'Rp ${_group(amount)}';

/// Bentuk rapat untuk kartu dan angka besar: `Rp1.500.000` (DESIGN.md §6.4).
String rupiahTight(int amount) => rupiah(amount).replaceFirst('Rp ', 'Rp');

String two(int value) => value.toString().padLeft(2, '0');

/// Parse integer rupiah dari Map — handle string BIGINT dari API.
int? moneyValue(Map<String, dynamic> m, String key) {
  final v = m[key];
  if (v == null) return null;
  if (v is num) return v.toInt();
  return int.tryParse('$v');
}

/// Formats phone digits to Indonesian format: `0812-3456-7890`.
String formatIndonesianPhone(String? raw) {
  if (raw == null || raw.isEmpty) return '-';
  var digits = raw.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('62')) {
    digits = '0${digits.substring(2)}';
  } else if (!digits.startsWith('0')) {
    digits = '0$digits';
  }
  if (digits.length <= 4) return digits;
  final parts = <String>[];
  parts.add(digits.substring(0, 4.clamp(0, digits.length)));
  var rest = digits.length > 4 ? digits.substring(4) : '';
  while (rest.isNotEmpty) {
    final take = rest.length > 4 ? 4 : rest.length;
    parts.add(rest.substring(0, take));
    rest = rest.substring(take);
  }
  return parts.join('-');
}

/// `YYYY-MM-DD`, the API's date format.
String isoDate(DateTime date) => '${date.year}-${two(date.month)}-${two(date.day)}';

String formatDate(DateTime date) =>
    '${date.day} ${_months[date.month - 1]} ${date.year}';

String formatDayMonth(DateTime date) =>
    '${date.day} ${_months[date.month - 1]}';

String formatTime(DateTime date) => '${two(date.hour)}.${two(date.minute)}';

/// Accepts `YYYY-MM-DD` or an ISO timestamp from the API.
String formatDateIso(String? value) {
  if (value == null || value.isEmpty) return '-';
  final parsed = DateTime.tryParse(value);
  return parsed == null ? value : formatDate(parsed);
}

String formatDateRange(String startIso, String endIso) {
  final start = DateTime.tryParse(startIso);
  final end = DateTime.tryParse(endIso);
  if (start == null || end == null) return '$startIso – $endIso';
  if (start.year == end.year && start.month == end.month && start.day == end.day) {
    return formatDate(start);
  }
  return '${formatDayMonth(start)} – ${formatDate(end)}';
}

/// Session/availability wording, plain Indonesian.
String sessionLabel(String session) => switch (session.toLowerCase()) {
  'morning' => 'Pagi',
  'afternoon' => 'Siang',
  'evening' => 'Malam',
  'full_day' => 'Sehari penuh',
  _ => session.replaceAll('_', ' '),
};

String relativeFreshness(String? isoTimestamp, {int staleAfterDays = 7}) {
  final timestamp = isoTimestamp == null ? null : DateTime.tryParse(isoTimestamp);
  if (timestamp == null) return 'Jadwal belum pernah diperbarui.';
  final days = DateTime.now().toUtc().difference(timestamp.toUtc()).inDays;
  if (days <= 0) return 'Jadwal diperbarui hari ini.';
  if (days == 1) return 'Jadwal diperbarui kemarin.';
  if (days > staleAfterDays) return 'Jadwal mungkin sudah berubah ($days hari lalu).';
  return 'Jadwal diperbarui $days hari lalu.';
}
