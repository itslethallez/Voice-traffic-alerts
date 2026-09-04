package expo.modules.facebooknotificationlistener

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

internal const val FACEBOOK_NOTIFICATION_EVENT = "onFacebookNotification"
private const val LISTENER_SERVICE_CLASS =
  "expo.modules.facebooknotificationlistener.FacebookNotificationListenerService"

internal object FacebookNotificationEventRelay {
  @Volatile
  private var moduleReference: WeakReference<FacebookNotificationListenerModule>? = null

  fun attach(module: FacebookNotificationListenerModule) {
    moduleReference = WeakReference(module)
  }

  fun detach(module: FacebookNotificationListenerModule) {
    if (moduleReference?.get() === module) {
      moduleReference = null
    }
  }

  fun publish(event: Bundle) {
    moduleReference?.get()?.emitFacebookNotification(event)
  }
}

class FacebookNotificationListenerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FacebookNotificationListener")

    Events(FACEBOOK_NOTIFICATION_EVENT)

    OnCreate {
      FacebookNotificationEventRelay.attach(this@FacebookNotificationListenerModule)
    }

    OnDestroy {
      FacebookNotificationEventRelay.detach(this@FacebookNotificationListenerModule)
    }

    AsyncFunction<Boolean>("isNotificationAccessGrantedAsync") {
      isNotificationAccessGranted(context)
    }

    AsyncFunction<String>("getNotificationAccessStatusAsync") {
      if (isNotificationAccessGranted(context)) "granted" else "denied"
    }

    AsyncFunction<Boolean>("openNotificationAccessSettingsAsync") {
      try {
        context.startActivity(
          Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        )
        true
      } catch (_: ActivityNotFoundException) {
        false
      }
    }
  }

  internal fun emitFacebookNotification(event: Bundle) {
    try {
      sendEvent(FACEBOOK_NOTIFICATION_EVENT, event)
    } catch (_: Throwable) {
      // The service may outlive the React bridge; drop the event without logging content.
    }
  }

  private fun isNotificationAccessGranted(context: Context): Boolean {
    val enabledListeners = Settings.Secure.getString(
      context.contentResolver,
      "enabled_notification_listeners"
    ) ?: return false
    val listenerComponent = ComponentName(context.packageName, LISTENER_SERVICE_CLASS)

    return enabledListeners
      .split(':')
      .mapNotNull(ComponentName::unflattenFromString)
      .any { it == listenerComponent }
  }
}
