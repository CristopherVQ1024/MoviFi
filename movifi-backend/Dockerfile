FROM node:24-slim
# tzdata + TZ: el backend calcula "hoy" y "este mes" con la hora local, no con UTC
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=America/Lima
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
EXPOSE 3000
# ipv4first: algunas redes (y Google Cloud) fallan al conectar con la API de Mistral por IPv6
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
