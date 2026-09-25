FROM alpine:3.20

RUN apk add --no-cache curl ca-certificates && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then SC_ARCH="amd64"; \
    elif [ "$ARCH" = "aarch64" ]; then SC_ARCH="arm64"; \
    elif [ "$ARCH" = "armv7l" ]; then SC_ARCH="arm"; \
    else SC_ARCH="amd64"; fi && \
    curl -fsSLO "https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-${SC_ARCH}" && \
    chmod +x "supercronic-linux-${SC_ARCH}" && \
    mv "supercronic-linux-${SC_ARCH}" /usr/local/bin/supercronic

WORKDIR /app

COPY crontab /app/crontab

CMD ["/usr/local/bin/supercronic", "/app/crontab"]
