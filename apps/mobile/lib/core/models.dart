/// Hand-written models for the frozen API shapes. Integer rupiah, dates as
/// `YYYY-MM-DD`, timestamps ISO-8601 UTC — kept as strings, parsed on demand.
library;

Map<String, dynamic> _map(dynamic value) =>
    value is Map ? value.cast<String, dynamic>() : const <String, dynamic>{};

List<Map<String, dynamic>> _maps(dynamic value) => value is List
    ? value.map(_map).toList(growable: false)
    : const <Map<String, dynamic>>[];

int _int(dynamic value) =>
    value is num ? value.toInt() : int.tryParse('$value') ?? 0;

int? _intOrNull(dynamic value) => value == null ? null : _int(value);

double? _double(dynamic value) =>
    value == null ? null : (value is num ? value.toDouble() : double.tryParse('$value'));

String _string(dynamic value) => value?.toString() ?? '';

String? _stringOrNull(dynamic value) =>
    value == null || '$value'.isEmpty ? null : '$value';

class AppUser {
  const AppUser({
    required this.id,
    required this.phone,
    required this.roles,
    this.email,
    this.fullName,
    this.createdAt,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
    id: _string(json['id']),
    phone: _string(json['phone']),
    roles: (json['roles'] as List?)?.map((r) => '$r').toList(growable: false) ?? const [],
    email: _stringOrNull(json['email']),
    fullName: _stringOrNull(json['full_name']),
    createdAt: _stringOrNull(json['created_at']),
  );

  final String id;
  final String phone;
  final List<String> roles;
  final String? email;
  final String? fullName;
  final String? createdAt;

  String get label => fullName ?? email ?? phone;
}

class Addon {
  const Addon({
    required this.id,
    required this.name,
    required this.priceIdr,
    required this.unit,
    required this.maxQty,
  });

  factory Addon.fromJson(Map<String, dynamic> json) => Addon(
    id: _string(json['id']),
    name: _string(json['name']),
    priceIdr: _int(json['price_idr']),
    unit: _string(json['unit']),
    maxQty: _int(json['max_qty']),
  );

  final String id;
  final String name;
  final int priceIdr;
  final String unit;
  final int maxQty;
}

class VendorPackage {
  const VendorPackage({
    required this.id,
    required this.name,
    required this.durationMinutes,
    required this.personnelCount,
    required this.basePriceIdr,
    this.description,
    this.addons = const [],
  });

  factory VendorPackage.fromJson(Map<String, dynamic> json) => VendorPackage(
    id: _string(json['id']),
    name: _string(json['name']),
    description: _stringOrNull(json['description']),
    durationMinutes: _int(json['duration_minutes']),
    personnelCount: _int(json['personnel_count']),
    basePriceIdr: _int(json['base_price_idr']),
    addons: _maps(json['addons']).map(Addon.fromJson).toList(growable: false),
  );

  final String id;
  final String name;
  final String? description;
  final int durationMinutes;
  final int personnelCount;
  final int basePriceIdr;
  final List<Addon> addons;
}

class VendorSummary {
  const VendorSummary({
    required this.id,
    required this.slug,
    required this.displayName,
    required this.regionCode,
    required this.regionName,
    required this.rating,
    required this.ratingCount,
    required this.minDpBp,
    required this.startingPriceIdr,
    required this.packageCount,
    this.baseAddress,
    this.description,
  });

  factory VendorSummary.fromJson(Map<String, dynamic> json) => VendorSummary(
    id: _string(json['id']),
    slug: _string(json['slug']),
    displayName: _string(json['display_name']),
    regionCode: _string(json['region_code']),
    regionName: _string(json['region_name']),
    baseAddress: _stringOrNull(json['base_address']),
    description: _stringOrNull(json['description']),
    rating: _double(json['rating']),
    ratingCount: _int(json['rating_count']),
    minDpBp: _int(json['min_dp_bp']),
    startingPriceIdr: _int(json['starting_price_idr']),
    packageCount: _int(json['package_count']),
  );

  final String id;
  final String slug;
  final String displayName;
  final String regionCode;
  final String regionName;
  final String? baseAddress;
  final String? description;
  final double? rating;
  final int ratingCount;
  final int minDpBp;
  final int startingPriceIdr;
  final int packageCount;
}

class LatLng {
  const LatLng({required this.lat, required this.lng});

  factory LatLng.fromJson(Map<String, dynamic> json) =>
      LatLng(lat: _double(json['lat']) ?? 0, lng: _double(json['lng']) ?? 0);

  final double lat;
  final double lng;
}

class VendorDetail {
  const VendorDetail({
    required this.id,
    required this.slug,
    required this.displayName,
    required this.regionCode,
    required this.regionName,
    required this.rating,
    required this.ratingCount,
    required this.minDpBp,
    required this.serviceRadiusKm,
    required this.transportFeePerKmIdr,
    required this.whatsapp,
    required this.packages,
    this.legalName,
    this.description,
    this.baseAddress,
    this.location,
  });

  factory VendorDetail.fromJson(Map<String, dynamic> json) => VendorDetail(
    id: _string(json['id']),
    slug: _string(json['slug']),
    displayName: _string(json['display_name']),
    legalName: _stringOrNull(json['legal_name']),
    description: _stringOrNull(json['description']),
    regionCode: _string(json['region_code']),
    regionName: _string(json['region_name']),
    baseAddress: _stringOrNull(json['base_address']),
    location: json['location'] == null ? null : LatLng.fromJson(_map(json['location'])),
    serviceRadiusKm: _double(json['service_radius_km']) ?? 0,
    transportFeePerKmIdr: _int(json['transport_fee_per_km_idr']),
    minDpBp: _int(json['min_dp_bp']),
    rating: _double(json['rating']),
    ratingCount: _int(json['rating_count']),
    whatsapp: _string(json['whatsapp']),
    packages: _maps(json['packages']).map(VendorPackage.fromJson).toList(growable: false),
  );

  final String id;
  final String slug;
  final String displayName;
  final String? legalName;
  final String? description;
  final String regionCode;
  final String regionName;
  final String? baseAddress;
  final LatLng? location;
  final double serviceRadiusKm;
  final int transportFeePerKmIdr;
  final int minDpBp;
  final double? rating;
  final int ratingCount;
  final String whatsapp;
  final List<VendorPackage> packages;
}

class AvailabilityDay {
  const AvailabilityDay({
    required this.date,
    required this.session,
    required this.state,
    this.holdExpiresAt,
  });

  factory AvailabilityDay.fromJson(Map<String, dynamic> json) => AvailabilityDay(
    date: _string(json['date']),
    session: _string(json['session']),
    state: _string(json['availability_state']),
    holdExpiresAt: _stringOrNull(json['hold_expires_at']),
  );

  final String date;
  final String session;
  final String state;
  final String? holdExpiresAt;
}

class Availability {
  const Availability({
    required this.vendorId,
    required this.from,
    required this.to,
    required this.stale,
    required this.staleThresholdDays,
    required this.days,
    this.calendarUpdatedAt,
  });

  factory Availability.fromJson(Map<String, dynamic> json) => Availability(
    vendorId: _string(json['vendor_id']),
    from: _string(json['from']),
    to: _string(json['to']),
    calendarUpdatedAt: _stringOrNull(json['calendar_updated_at']),
    stale: json['stale'] == true,
    staleThresholdDays: _int(json['stale_threshold_days']),
    days: _maps(json['days']).map(AvailabilityDay.fromJson).toList(growable: false),
  );

  final String vendorId;
  final String from;
  final String to;
  final String? calendarUpdatedAt;
  final bool stale;
  final int staleThresholdDays;
  final List<AvailabilityDay> days;
}

class BookingSlot {
  const BookingSlot({required this.date, required this.session});

  factory BookingSlot.fromJson(Map<String, dynamic> json) =>
      BookingSlot(date: _string(json['date']), session: _string(json['session']));

  final String date;
  final String session;
}

class BookingVendor {
  const BookingVendor({
    required this.id,
    required this.slug,
    required this.displayName,
    this.whatsapp,
  });

  factory BookingVendor.fromJson(Map<String, dynamic> json) => BookingVendor(
    id: _string(json['id']),
    slug: _string(json['slug']),
    displayName: _string(json['display_name']),
    whatsapp: _stringOrNull(json['whatsapp']),
  );

  final String id;
  final String slug;
  final String displayName;
  final String? whatsapp;
}

class BookingPackage {
  const BookingPackage({required this.id, required this.name});

  factory BookingPackage.fromJson(Map<String, dynamic> json) =>
      BookingPackage(id: _string(json['id']), name: _string(json['name']));

  final String id;
  final String name;
}

class BookingEvent {
  const BookingEvent({
    required this.title,
    required this.regionCode,
    required this.venueAddress,
    required this.startDate,
    required this.endDate,
    this.eventType,
    this.venueName,
    this.guestEstimate,
    this.notes,
  });

  factory BookingEvent.fromJson(Map<String, dynamic> json) => BookingEvent(
    title: _string(json['title']),
    eventType: _stringOrNull(json['event_type']),
    regionCode: _string(json['region_code']),
    venueName: _stringOrNull(json['venue_name']),
    venueAddress: _string(json['venue_address']),
    startDate: _string(json['start_date']),
    endDate: _string(json['end_date']),
    guestEstimate: _intOrNull(json['guest_estimate']),
    notes: _stringOrNull(json['notes']),
  );

  final String title;
  final String? eventType;
  final String regionCode;
  final String? venueName;
  final String venueAddress;
  final String startDate;
  final String endDate;
  final int? guestEstimate;
  final String? notes;
}

class BookingSummary {
  const BookingSummary({
    required this.id,
    required this.code,
    required this.lifecycleStatus,
    required this.paymentStatus,
    required this.settlementStatus,
    required this.vendor,
    required this.package,
    required this.totalCustomerIdr,
    required this.dpAmountIdr,
    required this.outstandingIdr,
    required this.createdAt,
    required this.updatedAt,
    this.firstSlot,
  });

  factory BookingSummary.fromJson(Map<String, dynamic> json) => BookingSummary(
    id: _string(json['id']),
    code: _string(json['code']),
    lifecycleStatus: _string(json['lifecycle_status']),
    paymentStatus: _string(json['payment_status']),
    settlementStatus: _string(json['settlement_status']),
    vendor: BookingVendor.fromJson(_map(json['vendor'])),
    package: BookingPackage.fromJson(_map(json['package'])),
    totalCustomerIdr: _int(json['total_customer_idr']),
    dpAmountIdr: _int(json['dp_amount_idr']),
    outstandingIdr: _int(json['outstanding_idr']),
    firstSlot: json['first_slot'] == null ? null : BookingSlot.fromJson(_map(json['first_slot'])),
    createdAt: _string(json['created_at']),
    updatedAt: _string(json['updated_at']),
  );

  final String id;
  final String code;
  final String lifecycleStatus;
  final String paymentStatus;
  final String settlementStatus;
  final BookingVendor vendor;
  final BookingPackage package;
  final int totalCustomerIdr;
  final int dpAmountIdr;
  final int outstandingIdr;
  final BookingSlot? firstSlot;
  final String createdAt;
  final String updatedAt;
}

class BookingView {
  const BookingView({
    required this.id,
    required this.code,
    required this.lifecycleStatus,
    required this.paymentStatus,
    required this.settlementStatus,
    required this.vendor,
    required this.package,
    required this.event,
    required this.slots,
    required this.pricing,
    required this.totalCustomerIdr,
    required this.dpAmountIdr,
    required this.outstandingIdr,
    required this.createdAt,
    required this.updatedAt,
  });

  factory BookingView.fromJson(Map<String, dynamic> json) => BookingView(
    id: _string(json['id']),
    code: _string(json['code']),
    lifecycleStatus: _string(json['lifecycle_status']),
    paymentStatus: _string(json['payment_status']),
    settlementStatus: _string(json['settlement_status']),
    vendor: BookingVendor.fromJson(_map(json['vendor'])),
    package: BookingPackage.fromJson(_map(json['package'])),
    event: BookingEvent.fromJson(_map(json['event'])),
    slots: _maps(json['slots']).map(BookingSlot.fromJson).toList(growable: false),
    pricing: _map(json['pricing']),
    totalCustomerIdr: _int(json['total_customer_idr']),
    dpAmountIdr: _int(json['dp_amount_idr']),
    outstandingIdr: _int(json['outstanding_idr']),
    createdAt: _string(json['created_at']),
    updatedAt: _string(json['updated_at']),
  );

  final String id;
  final String code;
  final String lifecycleStatus;
  final String paymentStatus;
  final String settlementStatus;
  final BookingVendor vendor;
  final BookingPackage package;
  final BookingEvent event;
  final List<BookingSlot> slots;
  final Map<String, dynamic> pricing;
  final int totalCustomerIdr;
  final int dpAmountIdr;
  final int outstandingIdr;
  final String createdAt;
  final String updatedAt;
}

class PaymentInstruction {
  const PaymentInstruction({
    required this.type,
    this.qrString,
    this.vaNumber,
    this.bank,
    this.expiresAt,
  });

  factory PaymentInstruction.fromJson(Map<String, dynamic> json) => PaymentInstruction(
    type: _string(json['type']),
    qrString: _stringOrNull(json['qr_string']),
    vaNumber: _stringOrNull(json['va_number']),
    bank: _stringOrNull(json['bank']),
    expiresAt: _stringOrNull(json['expires_at']),
  );

  final String type;
  final String? qrString;
  final String? vaNumber;
  final String? bank;
  final String? expiresAt;
}

class Payment {
  const Payment({
    required this.id,
    required this.status,
    required this.amountIdr,
    required this.method,
    this.expiresAt,
    this.paidAt,
  });

  factory Payment.fromJson(Map<String, dynamic> json) => Payment(
    id: _string(json['id']),
    status: _string(json['status']),
    amountIdr: _int(json['amount_idr']),
    method: _string(json['method']),
    expiresAt: _stringOrNull(json['expires_at']),
    paidAt: _stringOrNull(json['paid_at']),
  );

  final String id;
  final String status;
  final int amountIdr;
  final String method;
  final String? expiresAt;
  final String? paidAt;
}

class PaymentView {
  const PaymentView({required this.payment, this.instruction});

  factory PaymentView.fromJson(Map<String, dynamic> json) => PaymentView(
    payment: Payment.fromJson(_map(json['payment'])),
    instruction: json['payment_instruction'] == null
        ? null
        : PaymentInstruction.fromJson(_map(json['payment_instruction'])),
  );

  final Payment payment;
  final PaymentInstruction? instruction;
}

/// Raw list envelope shared by catalog and booking lists.
class PageResult<T> {
  const PageResult({
    required this.items,
    required this.total,
    required this.page,
    required this.pageSize,
  });

  factory PageResult.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) parse,
  ) => PageResult(
    items: _maps(json['items']).map(parse).toList(growable: false),
    total: _int(json['total']),
    page: _int(json['page']),
    pageSize: _int(json['page_size']),
  );

  final List<T> items;
  final int total;
  final int page;
  final int pageSize;
}

class Policy {
  const Policy({
    required this.id,
    required this.code,
    required this.version,
    required this.bodyHash,
    required this.effectiveFrom,
    required this.body,
  });

  factory Policy.fromJson(Map<String, dynamic> json) => Policy(
    id: _string(json['id']),
    code: _string(json['code']),
    version: _string(json['version']),
    bodyHash: _string(json['body_hash']),
    effectiveFrom: _string(json['effective_from']),
    body: json['body'],
  );

  final String id;
  final String code;
  final String version;
  final String bodyHash;
  final String effectiveFrom;
  final dynamic body;
}
