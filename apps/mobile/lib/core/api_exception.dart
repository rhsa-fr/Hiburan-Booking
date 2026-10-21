/// Error envelope from the API, plus transport failures.
class ApiException implements Exception {
  const ApiException({
    required this.code,
    required this.message,
    this.details,
    this.statusCode,
  });

  final String code;
  final String message;
  final dynamic details;
  final int? statusCode;

  bool get isAuth => code == 'UNAUTHENTICATED' || statusCode == 401;

  /// Plain-Indonesian copy safe to show to a customer.
  String get userMessage => switch (code) {
    'VALIDATION_ERROR' => 'Data belum lengkap atau formatnya salah. Periksa lagi.',
    'UNAUTHENTICATED' => 'Sesi kamu berakhir. Silakan masuk lagi.',
    'FORBIDDEN' => 'Kamu tidak punya akses ke langkah ini.',
    'NOT_FOUND' => 'Data tidak ditemukan. Mungkin sudah dihapus.',
    'CONFLICT' => 'Data berubah saat diproses. Muat ulang lalu coba lagi.',
    'SLOT_UNAVAILABLE' =>
      'Jadwal itu baru saja terisi. Pilih tanggal atau sesi lain.',
    'IDEMPOTENCY_MISMATCH' =>
      'Pembayaran ini sudah diproses dengan data berbeda. Buka status booking.',
    'RATE_LIMITED' => 'Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi.',
    'UPSTREAM_ERROR' => 'Layanan sedang sibuk. Coba lagi sebentar.',
    'NETWORK_ERROR' || 'TIMEOUT' =>
      'Tidak bisa terhubung ke server. Periksa sinyal internet, lalu coba lagi.',
    _ => 'Ada masalah di server. Coba lagi sebentar.',
  };

  @override
  String toString() => 'ApiException($code${statusCode == null ? '' : ' $statusCode'}): $message';
}
