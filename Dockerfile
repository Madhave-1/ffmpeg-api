FROM node:18-bullseye

# Install ffmpeg + fonts (Hindi + Latin + emoji)
RUN apt-get update && \
    apt-get install -y ffmpeg fonts-noto fonts-noto-cjk fonts-noto-color-emoji && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Render will respect PORT
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
