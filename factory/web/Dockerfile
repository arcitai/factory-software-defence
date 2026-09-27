FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /opt/factory-web
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY --chmod=0555 launch-chromium.sh /opt/factory-web/launch-chromium.sh
COPY runner.mjs readiness.mjs ./
CMD ["node", "/opt/factory-web/runner.mjs"]
