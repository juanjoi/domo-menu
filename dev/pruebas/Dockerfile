FROM golang:1.27-alpine AS compilar
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /pruebas .

FROM scratch
COPY --from=compilar /pruebas /pruebas
ENTRYPOINT ["/pruebas"]
