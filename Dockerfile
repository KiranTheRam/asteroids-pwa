# Asteroids PWA — a zero-build static site served by nginx.
FROM nginx:1.30-alpine

# nginx server config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# App shell (explicit copies so no configs/dotfiles leak into the image)
COPY index.html styles.css manifest.webmanifest sw.js /usr/share/nginx/html/
COPY src/   /usr/share/nginx/html/src/
COPY icons/ /usr/share/nginx/html/icons/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ >/dev/null 2>&1 || exit 1
