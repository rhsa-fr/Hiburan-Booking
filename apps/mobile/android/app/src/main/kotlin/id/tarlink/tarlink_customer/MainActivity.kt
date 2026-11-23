package id.tarlink.tarlink_customer

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.security.MessageDigest

/**
 * Hosts the `app_update` channel: installed version, APK digest, and the system
 * installer. Android-only by construction; the Dart side never calls it
 * elsewhere.
 */
class MainActivity : FlutterActivity() {
    private companion object {
        const val CHANNEL = "id.tarlink.tarlink_customer/app_update"
        const val MIME_APK = "application/vnd.android.package-archive"
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "deviceInfo" -> result.success(deviceInfo())
                    "canInstallPackages" -> result.success(canInstallPackages())
                    "openInstallSettings" -> result.success(openInstallSettings())
                    "sha256OfFile" -> {
                        val path = call.argument<String>("path")
                        if (path == null) {
                            result.error("BAD_ARGS", "path is required", null)
                        } else {
                            result.success(sha256OfFile(path))
                        }
                    }
                    "installApk" -> {
                        val path = call.argument<String>("path")
                        if (path == null) {
                            result.error("BAD_ARGS", "path is required", null)
                        } else {
                            result.success(installApk(path))
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    @Suppress("DEPRECATION")
    private fun deviceInfo(): Map<String, Any> {
        val info = packageManager.getPackageInfo(packageName, 0)
        val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode.toInt()
        } else {
            info.versionCode
        }
        return mapOf(
            "versionName" to (info.versionName ?: ""),
            "versionCode" to versionCode,
            "abis" to Build.SUPPORTED_ABIS.toList(),
            "cacheDir" to cacheDir.absolutePath,
        )
    }

    private fun canInstallPackages(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            packageManager.canRequestPackageInstalls()
        } else {
            true
        }

    private fun openInstallSettings(): Boolean {
        return try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$packageName"),
                )
            } else {
                Intent(Settings.ACTION_SECURITY_SETTINGS)
            }
            startActivity(intent)
            true
        } catch (error: Exception) {
            false
        }
    }

    /** Streamed digest: an APK is 100+ MB, so the file is never read at once. */
    private fun sha256OfFile(path: String): String? {
        val file = File(path)
        if (!file.isFile) return null
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    digest.update(buffer, 0, read)
                }
            }
            digest.digest().joinToString("") { byte ->
                "%02x".format(byte.toInt() and 0xff)
            }
        } catch (error: Exception) {
            null
        }
    }

    /**
     * Opens the system installer through a FileProvider URI. Returns an error
     * code instead of throwing so Dart can show one Indonesian line per case.
     */
    private fun installApk(path: String): String {
        val file = File(path)
        if (!file.isFile) return "FILE_MISSING"
        if (!canInstallPackages()) return "NO_PERMISSION"
        return try {
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, MIME_APK)
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_ACTIVITY_NEW_TASK,
                )
            }
            startActivity(intent)
            "OK"
        } catch (error: ActivityNotFoundException) {
            "NO_ACTIVITY"
        } catch (error: Exception) {
            "FAILED"
        }
    }
}
