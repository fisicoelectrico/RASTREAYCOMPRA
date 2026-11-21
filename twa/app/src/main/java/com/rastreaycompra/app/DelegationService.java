package com.rastreaycompra.app;

import com.google.androidbrowserhelper.trusted.NotificationPermissionRequestHandler;

/**
 * Servicio que Chrome usa para "delegar" las notificaciones Web Push en la app:
 * así la notificación aparece con el nombre y el ícono de RastreaYCompra (no de Chrome),
 * y en Android 13+ el permiso de notificaciones se pide como permiso de la app.
 */
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();
        registerExtraCommandHandler(new NotificationPermissionRequestHandler());
    }
}
