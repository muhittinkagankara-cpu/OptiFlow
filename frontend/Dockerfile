# OptiFlow arayuzu — uretim kapsayicisi.
#
# Vite ciktisi statik dosyalardir; calisma zamaninda Node gerekmez. Bu yuzden
# derleme ayri bir asamada yapilir ve son imaj yalnizca nginx ile statik
# dosyalari tasir. Node imaji ile yayinlansaydi imaj yuzlerce megabayt
# buyur ve gereksiz bir calisma zamani saldiri yuzeyi eklenirdi.

FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# API adresi derleme zamaninda gomulur: Vite ortam degiskenlerini pakete
# yazar, calisma zamaninda okunamaz.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build


FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --spider -q http://127.0.0.1/ || exit 1
