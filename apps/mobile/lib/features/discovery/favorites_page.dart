import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/models.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import '../booking/booking_support.dart';

class FavoritesPage extends StatefulWidget {
  const FavoritesPage({super.key});

  @override
  State<FavoritesPage> createState() => _FavoritesPageState();
}

class _FavoritesPageState extends State<FavoritesPage> {
  final _vendors = <VendorSummary>[];
  bool _loading = true;
  String? _error;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _load();
  }

  Future<void> _load({bool fromRefresh = false}) async {
    final api = AppScope.of(context).api;
    if (!fromRefresh) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final raw = await api.get(
        '/favorites',
        query: const {'page': '1', 'page_size': '50'},
      );
      if (!mounted) return;
      if (raw is! Map) {
        throw const ApiException(
          code: 'INTERNAL_ERROR',
          message: 'Daftar favorit tidak bisa dibaca.',
        );
      }
      final result = PageResult<VendorSummary>.fromJson(
        raw.cast<String, dynamic>(),
        VendorSummary.fromJson,
      );
      setState(() {
        _vendors
          ..clear()
          ..addAll(result.items);
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      if (fromRefresh && _vendors.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(apiMessage(error))),
        );
      } else {
        setState(() {
          _error = apiMessage(error);
          _loading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      if (fromRefresh && _vendors.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Daftar favorit tidak bisa diperbarui. Periksa sinyal.',
            ),
          ),
        );
      } else {
        setState(() {
          _error =
              'Daftar favorit tidak bisa dimuat. Periksa sinyal, lalu coba lagi.';
          _loading = false;
        });
      }
    }
  }

  Future<void> _openVendor(VendorSummary vendor) async {
    final arg = vendor.slug.isNotEmpty ? vendor.slug : vendor.id;
    await Navigator.pushNamed(context, Routes.vendor, arguments: arg);
    if (!mounted) return;
    _load(fromRefresh: true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          StageHeader.back(
            context: context,
            title: 'Favorit Saya',
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    return RefreshIndicator(
      onRefresh: () => _load(fromRefresh: true),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          if (_loading && _vendors.isEmpty)
            const SliverPadding(
              padding: EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, Sp.xl),
              sliver: SliverToBoxAdapter(
                child: AppLoading(rows: 3, label: 'Memuat favorit'),
              ),
            )
          else if (_error != null && _vendors.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: AppError(
                message: _error!,
                onRetry: () => _load(),
              ),
            )
          else if (_vendors.isEmpty)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: AppEmpty(
                icon: Icons.favorite_border,
                message:
                    'Belum ada vendor favorit. Ketuk ♡ di halaman vendor untuk menyimpan.',
              ),
            )
          else ...[
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.xl),
              sliver: SliverList.builder(
                itemCount: _vendors.length,
                itemBuilder: (context, index) {
                  final vendor = _vendors[index];
                  return Padding(
                    padding: EdgeInsets.only(
                      bottom: index == _vendors.length - 1 ? 0 : Sp.sm,
                    ),
                    child: VendorCard(
                      vendor: vendor,
                      onTap: () => _openVendor(vendor),
                    ),
                  );
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}
