FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
COPY templates ./templates
# CGO выключен, иначе бинарник не запустится в пустом scratch/alpine-образе.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/klubok .

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/klubok .
# Шаблоны вшиты через embed, а вот static/ читается с диска — его надо положить.
COPY static ./static
ENV PORT=8080
EXPOSE 8080
CMD ["./klubok"]
