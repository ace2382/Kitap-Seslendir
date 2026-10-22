package com.kitapseslendir.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;

/**
 * Seslendirme sürerken uygulamanın ekran kilitlenince ya da arka plana alınınca
 * sonlandırılmaması için öncelikli (foreground) servis + "Duraklat" düğmeli bildirim.
 */
public class PlaybackService extends Service {
    private static final String TAG = "PlaybackService";
    static final String CHANNEL_ID = "kitap_seslendir_playback";
    static final int NOTIFICATION_ID = 4201;
    static final String ACTION_START = "com.kitapseslendir.app.START";
    static final String ACTION_PAUSE = "com.kitapseslendir.app.PAUSE";
    static final String EXTRA_TITLE = "title";

    static void start(Context context, String title) {
        Intent intent = new Intent(context, PlaybackService.class).setAction(ACTION_START).putExtra(EXTRA_TITLE, title);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (Exception e) {
            // Servis başlatılamasa da seslendirme (ön planda) devam eder.
            Log.w(TAG, "Servis başlatılamadı: " + e.getMessage());
        }
    }

    static void stop(Context context) {
        try {
            context.stopService(new Intent(context, PlaybackService.class));
        } catch (Exception e) {
            Log.w(TAG, "Servis durdurulamadı: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PAUSE.equals(action)) {
            NativeTTSPlugin.pauseFromNotification();
            stopSelf();
            return START_NOT_STICKY;
        }
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        Notification notification = buildNotification(title == null ? "Kitap" : title);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.w(TAG, "startForeground başarısız: " + e.getMessage());
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Uygulama son uygulamalardan kaydırılıp kapatılırsa seslendirme de durur.
        NativeTTSPlugin.pauseFromNotification();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification(String title) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Seslendirme", NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("Kitap seslendirilirken gösterilir");
                nm.createNotificationChannel(channel);
            }
        }
        int immutable = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent open = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | immutable);
        Intent pause = new Intent(this, PlaybackService.class).setAction(ACTION_PAUSE);
        PendingIntent pausePending = PendingIntent.getService(this, 1, pause, PendingIntent.FLAG_UPDATE_CURRENT | immutable);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Kitap Seslendir")
                .setContentText(title)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .addAction(android.R.drawable.ic_media_pause, "Duraklat", pausePending)
                .build();
    }
}
