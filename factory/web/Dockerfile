FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /opt/factory-web
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY runner.mjs readiness.mjs ./
CMD ["node", "/opt/factory-web/runner.mjs"]
