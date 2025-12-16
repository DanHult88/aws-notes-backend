FROM node:20-alpine

# ✅ Viktigt: behövs för TLS mot RDS (fixar “self-signed certificate in certificate chain”)
RUN apk add --no-cache ca-certificates && update-ca-certificates

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
EXPOSE 3000
CMD ["npm", "start"]
