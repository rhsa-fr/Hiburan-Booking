/// Bank codes accepted by the payout API. Mirrors
/// `libs/modules/payout/src/banks.ts`; keep the order stable so the dropdown
/// does not jump between builds.
class VendorBank {
  const VendorBank(this.code, this.name);

  final String code;
  final String name;
}

const List<VendorBank> vendorBanks = [
  VendorBank('bca', 'BCA'),
  VendorBank('bni', 'BNI'),
  VendorBank('bri', 'BRI'),
  VendorBank('mandiri', 'Mandiri'),
  VendorBank('bsi', 'BSI'),
  VendorBank('btn', 'BTN'),
  VendorBank('cimb', 'CIMB Niaga'),
  VendorBank('permata', 'Permata'),
  VendorBank('danamon', 'Danamon'),
  VendorBank('btpn', 'BTPN'),
  VendorBank('maybank', 'Maybank'),
  VendorBank('ocbc', 'OCBC'),
  VendorBank('mega', 'Bank Mega'),
  VendorBank('bjb', 'BJB'),
  VendorBank('sinarmas', 'Sinarmas'),
];
