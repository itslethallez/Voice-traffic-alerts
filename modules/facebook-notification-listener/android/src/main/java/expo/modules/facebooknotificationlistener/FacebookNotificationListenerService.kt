package expo.modules.facebooknotificationlistener

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

internal const val FACEBOOK_PACKAGE_NAME = "com.facebook.katana"

class FacebookNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName != FACEBOOK_PACKAGE_NAME) return

    val extras = sbn.notification.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val text = (
      extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
        ?: extras.getCharSequence(Notification.EXTRA_TEXT)
      )?.toString()
    val event = Bundle().apply {
      putString("packageName", FACEBOOK_PACKAGE_NAME)
      putString("notificationKey", sbn.key)
      putDouble("postedAt", sbn.postTime.toDouble())
      putString("title", title)
      putString("text", text)
    }

    FacebookNotificationEventRelay.publish(event)
  }
}
