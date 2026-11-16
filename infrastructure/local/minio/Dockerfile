# Build the pinned upstream community source; do not rely on a retired Hub image.
# Local development only. Review the storage implementation before M5.
FROM golang:1.25.5-alpine AS build
ENV CGO_ENABLED=0
RUN go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z

FROM alpine:3.22.2
RUN apk add --no-cache ca-certificates && mkdir /data && chown 10001:10001 /data
COPY --from=build /go/bin/minio /usr/local/bin/minio
USER 10001:10001
VOLUME /data
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
