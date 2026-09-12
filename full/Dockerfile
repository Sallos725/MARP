# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.27.1-bookworm AS build
ARG TARGETOS=linux
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -buildvcs=false -trimpath -ldflags="-s -w" -o /out/marp ./cmd/marp

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/marp /marp
WORKDIR /data
ENV HOST=0.0.0.0 PORT=6009 CONFIG_PATH=/data/config.json PRESET_PATH=/data/presets.json
EXPOSE 6009
ENTRYPOINT ["/marp"]
