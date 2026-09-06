package main

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

// ---------------------------------------------------------------------------
// Сжатие
//
// Go не сжимает ответы сам. Страница магазина — 24 КБ разметки, стили — 16 КБ,
// скрипт — 16 КБ; всё это текст и жмётся втрое-впятеро. На быстром канале
// разница незаметна, на медленном или нестабильном — это разница между
// «открылось» и «крутится».
//
// woff2 и уже минифицированные библиотеки не трогаем: woff2 сжат внутри
// самого формата, повторный gzip только тратит процессор.
// ---------------------------------------------------------------------------

var gzipPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return w
	},
}

type gzipWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

func (w gzipWriter) Write(b []byte) (int, error) { return w.gz.Write(b) }

// compressible решает по типу содержимого, а не по расширению: шаблоны
// отдаются без файлового имени вообще.
func compressible(ct string) bool {
	switch {
	case strings.HasPrefix(ct, "text/"),
		strings.HasPrefix(ct, "application/javascript"),
		strings.HasPrefix(ct, "application/json"),
		strings.HasPrefix(ct, "image/svg+xml"):
		return true
	}
	return false
}

func withGzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		// Тип ответа известен только после того, как хендлер его выставит,
		// поэтому решение о сжатии принимаем лениво — при первой записи.
		lazy := &lazyGzip{ResponseWriter: w}
		defer lazy.close()

		next.ServeHTTP(lazy, r)
	})
}

type lazyGzip struct {
	http.ResponseWriter
	gz      *gzip.Writer
	decided bool
	code    int
}

func (w *lazyGzip) WriteHeader(code int) {
	w.code = code
	w.decide()
	w.ResponseWriter.WriteHeader(code)
}

func (w *lazyGzip) decide() {
	if w.decided {
		return
	}
	w.decided = true

	if !compressible(w.Header().Get("Content-Type")) {
		return
	}

	// Длина после сжатия другая, а Content-Encoding запрещает её угадывать.
	w.Header().Del("Content-Length")
	w.Header().Set("Content-Encoding", "gzip")
	// Один и тот же URL отдаётся и сжатым, и нет — прокси обязаны различать.
	w.Header().Add("Vary", "Accept-Encoding")

	gz := gzipPool.Get().(*gzip.Writer)
	gz.Reset(w.ResponseWriter)
	w.gz = gz
}

func (w *lazyGzip) Write(b []byte) (int, error) {
	w.decide()
	if w.gz != nil {
		return w.gz.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

func (w *lazyGzip) close() {
	if w.gz == nil {
		return
	}
	w.gz.Close()
	gzipPool.Put(w.gz)
	w.gz = nil
}

// ---------------------------------------------------------------------------
// Кеширование статики
//
// Шрифты и библиотеки — 350 КБ, которые не меняются никогда. Без заголовков
// браузер каждый раз переспрашивает сервер, а на плохом канале даже
// переспросить стоит времени. Со своими стилями и скриптами осторожнее:
// их правят, поэтому браузер должен сверяться с сервером, но получать
// 304 вместо файла целиком.
// ---------------------------------------------------------------------------

func staticHandler() http.Handler {
	fs := http.FileServer(http.Dir("static"))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// StripPrefix срезает "/static/" вместе с ведущим слешем, поэтому
		// сюда приходит "fonts/x.woff2", а не "/fonts/x.woff2".
		path := strings.TrimPrefix(r.URL.Path, "/")

		switch {
		case strings.HasPrefix(path, "fonts/"), strings.HasPrefix(path, "js/vendor/"):
			// Содержимое этих файлов привязано к имени: обновление шрифта
			// или библиотеки — это новый файл с новым именем.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		default:
			// FileServer сам проставит Last-Modified и ответит 304, если
			// файл не менялся, — трафика не будет, только пустой ответ.
			w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
		}
		fs.ServeHTTP(w, r)
	})
}
