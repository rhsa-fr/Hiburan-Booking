/// Shared day-status projection for the vendor calendar and the dashboard strip.
///
/// A day has two sessions; the owner needs one label they can read at a glance,
/// not two tiny dots. `blocked` wins, then a fully booked day, then partial
/// occupancy, a live hold, and finally the free day.
String aggregateVendorDayState(String? dayState, String? nightState) {
  final states = [dayState, nightState].whereType<String>().toList();
  if (states.isEmpty) return 'empty';
  if (states.contains('blocked')) return 'blocked';
  final booked = states.where((state) => state == 'booked').length;
  if (booked == 2) return 'full';
  if (booked == 1) return 'partial';
  if (states.contains('held')) return 'held';
  if (states.length == 2 && states.every((state) => state == 'available')) {
    return 'open';
  }
  if (states.contains('available')) return 'partial';
  return 'empty';
}

String vendorDayStateLabel(String state) => switch (state) {
  'open' => 'Buka',
  'held' => 'Ditahan',
  'partial' => 'Sebagian',
  'full' => 'Penuh',
  'blocked' => 'Tutup',
  _ => 'Kosong',
};
