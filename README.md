# Déploiement HTTPS (reverse proxy + certificat)

Ce fichier explique comment déployer le backend derrière un reverse-proxy Nginx et activer TLS (Let's Encrypt via Certbot). Le serveur Express est configuré pour :

- `app.set('trust proxy', true)` pour faire confiance aux en-têtes du proxy (ex: `x-forwarded-proto`).
- Rediriger automatiquement HTTP → HTTPS si `FORCE_HTTPS=1` dans l'environnement.
- Restreindre `FRONTEND_ORIGINS` à vos origines autorisées (ex: `https://mon-domaine.tld`).

## Variables d'environnement recommandées

- `FORCE_HTTPS=1`  # active la redirection HTTP->HTTPS et HSTS
- `FRONTEND_ORIGINS=https://mon-domaine.tld`  # origines autorisées pour CORS
- `PORT=3000`  # port interne (Nginx fera le TLS)

### Secret JWT et bonnes pratiques

- `JWT_SECRET` **doit** être défini en production et être une valeur aléatoire et longue (ex: 32+ octets hex). Ne commitez jamais ce secret dans le dépôt.
- Générer un secret sécurisé (exemple):

```bash
openssl rand -hex 32
```

- Exemple de fichier d'environnement (ne pas commiter): [Backend/.env.example](Backend/.env.example)

- Stockage recommandé en production:
    - Utiliser un gestionnaire de secrets (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, etc.), ou
    - Placer les variables d'environnement dans un fichier sur le serveur avec permissions restreintes (`/etc/qr-backend.env`, chmod 600) et l'importer via `systemd` `EnvironmentFile=`.

- Exemple minimal `systemd` unit snippet (exporter les variables via `/etc/qr-backend.env`):

```ini
[Unit]
Description=QR Backend

[Service]
EnvironmentFile=/etc/qr-backend.env
ExecStart=/usr/bin/node /var/www/qr-project/Backend/server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

- Exemple de fichier `/etc/qr-backend.env` (protégez ce fichier avec `chmod 600`):

```bash
JWT_SECRET=put_the_openssl_generated_value_here
FORCE_HTTPS=1
FRONTEND_ORIGINS=https://votre-domaine.tld
PORT=3000
```

- Pour Docker, préférez `docker secrets` ou `env_file` configuré hors dépôt. Exemple `docker-compose` (secrets ou env_file selon votre orchestration).

- Rotation & sécurité:
    - Faites tourner `JWT_SECRET` si compromis — invalidez/regenérez tokens côté client si nécessaire.
    - Utilisez courte durée d'expiration pour les JWT (ex: 2h) et implémentez un moyen de révocation si nécessaire.


## Exemple de configuration Nginx (server block)

Remplacez `mon-domaine.tld` par votre nom de domaine.

```
server {
    listen 80;
    server_name mon-domaine.tld www.mon-domaine.tld;

    # Redirect all HTTP to HTTPS (handled by certbot or by nginx)
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name mon-domaine.tld www.mon-domaine.tld;

    ssl_certificate /etc/letsencrypt/live/mon-domaine.tld/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mon-domaine.tld/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Strict transport security
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header Connection "";
        proxy_read_timeout 90;
    }
}
```

## Obtenir et renouveler un certificat Let's Encrypt (Certbot)

Sur une distribution Debian/Ubuntu :

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx
# Vérifier la config nginx
sudo nginx -t
# Obtenir un certif et configurer nginx automatiquement
sudo certbot --nginx -d mon-domaine.tld -d www.mon-domaine.tld
# Certbot ajoute un renouvellement automatique (systemd timer)
```

Après génération du certificat, redémarrez Nginx :

```bash
sudo systemctl reload nginx
```

## Lancer le service Node derrière Nginx

Sur le serveur (exemple systemd unit):

```
Environment=FORCE_HTTPS=1
Environment=FRONTEND_ORIGINS=https://mon-domaine.tld
ExecStart=/usr/bin/node /var/www/qr-project/Backend/server.js
```

## Tests

- Ouvrir `https://mon-domaine.tld/health` (doit répondre JSON).
- Vérifier que `http://mon-domaine.tld/` redirige vers `https://...`.
- Vérifier que les en-têtes HSTS sont présents.

## Notes de sécurité supplémentaires

- Pour production, limiter `FRONTEND_ORIGINS` à vos domaines exacts.
- Pensez à ajouter une couche d'authentification si les endpoints `/saveCV` ou `/saveLetter` doivent être privés.
- Activez des logs et une surveillance pour détecter les abus.
