FROM golang:1.27-alpine AS compilar
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /domo-menu ./cmd/domo-menu
# Código del plugin, para que "instalar-plugin" lo copie al volumen de Traefik.
RUN mkdir /plugin && cp go.mod .traefik.yml /plugin/ \
 && for f in *.go; do case "$f" in *_test.go) ;; *) cp "$f" /plugin/ ;; esac; done

FROM scratch
COPY --from=compilar /domo-menu /domo-menu
COPY --from=compilar /plugin /plugin
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["/domo-menu", "comprobar"]
ENTRYPOINT ["/domo-menu"]
CMD ["servir"]
