FROM node:22-slim
WORKDIR /app
COPY . .
RUN mkdir -p /data && chown node:node /data && chmod +x /app/docker-entrypoint.sh
ENV ACELLA_DATA=/data PORT=3000 ACELLA_HOST=0.0.0.0 ACELLA_HTTPS=1 ACELLA_TRUST_PROXY=1
VOLUME /data
EXPOSE 3000
# inicia como root só para ajustar a permissão do volume e depois roda como usuário "node"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
