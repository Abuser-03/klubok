package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Шов 1: кто перед нами и откуда он пришёл
// ---------------------------------------------------------------------------

// Surface — витрина, через которую человек зашёл. Всё, что отличается между
// сайтом и Mini App, ветвится по этому значению и больше нигде.
type Surface string

const (
	SurfaceWeb      Surface = "web"
	SurfaceTelegram Surface = "tg"
)

// Viewer — опознанный посетитель. Ref используется как ключ корзины и как
// владелец заказа, поэтому он обязан быть стабильным: для сайта это id
// сессии из cookie, для Mini App — id пользователя Telegram, который не
// меняется при переходе с телефона на десктоп.
type Viewer struct {
	Surface Surface
	Ref     string
	Name    string
}

func (v Viewer) IsTelegram() bool { return v.Surface == SurfaceTelegram }

// tgUser — та часть initData, которая нам реально нужна.
type tgUser struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
}

// viewerFrom опознаёт посетителя.
//
// Mini App присылает initData заголовком Authorization на каждом запросе —
// не cookie, потому что WebView внутри мессенджера непредсказуемо режет
// сторонние cookie, а заголовок ставится из JS явно и работает везде.
// Если заголовка нет или подпись не сошлась, посетитель считается
// обычным веб-гостем: подделать телеграм-личность не выйдет, максимум
// откатишься до анонимной сессии.
func (s *Server) viewerFrom(w http.ResponseWriter, r *http.Request) Viewer {
	raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "tma ")
	if ok && s.botToken != "" {
		vals, err := VerifyInitData(raw, s.botToken, 24*time.Hour)
		if err != nil {
			log.Printf("initData отклонена: %v", err)
		} else {
			var u tgUser
			if err := json.Unmarshal([]byte(vals.Get("user")), &u); err == nil && u.ID != 0 {
				return Viewer{
					Surface: SurfaceTelegram,
					Ref:     fmt.Sprintf("tg:%d", u.ID),
					Name:    u.FirstName,
				}
			}
		}
	}
	return Viewer{Surface: SurfaceWeb, Ref: "web:" + sessionID(w, r)}
}

// ---------------------------------------------------------------------------
// Шов 2: какая оболочка оборачивает контент
// ---------------------------------------------------------------------------

// shell возвращает имя внешнего шаблона. Внутренности у обеих витрин
// одни и те же партиалы — различается только рама вокруг них: на сайте
// своя шапка, хиро и подвал, в Mini App всё это даёт сам Telegram.
func (v Viewer) shell() string {
	if v.IsTelegram() {
		return "layout-tg.html"
	}
	return "layout-web.html"
}

// ---------------------------------------------------------------------------
// Шов 3: чем запускается оплата
// ---------------------------------------------------------------------------

// PaymentIntent — то, что хендлер отдаёт наружу после создания заказа.
// Одна структура на обе витрины, разница только в том, какое поле заполнено.
type PaymentIntent struct {
	OrderID string
	Kind    string // "redirect" — увести на страницу шлюза, "invoice" — открыть окно Telegram
	URL     string
}

// PaymentProvider скрывает, чем именно платят. Товары здесь физические
// (брелки и шарфы едут почтой), поэтому обе витрины ходят в один и тот же
// платёжный шлюз — Telegram Stars обязательны только для цифровых товаров,
// нас это не касается. Разница лишь в способе показать окно оплаты.
type PaymentProvider interface {
	Start(orderID string, amount int, v Viewer) (PaymentIntent, error)
}

// WebPayments уводит на страницу шлюза обычным редиректом.
type WebPayments struct{ ShopID string }

func (p WebPayments) Start(orderID string, amount int, _ Viewer) (PaymentIntent, error) {
	// Здесь был бы вызов API шлюза с idempotency_key и возврат его confirmation_url.
	return PaymentIntent{
		OrderID: orderID,
		Kind:    "redirect",
		URL:     "https://pay.example.test/checkout/" + orderID,
	}, nil
}

// TelegramPayments готовит ссылку на инвойс, которую фронт открывает
// через tg.openInvoice — пользователь не покидает мессенджер.
type TelegramPayments struct{ BotToken, ProviderToken string }

func (p TelegramPayments) Start(orderID string, amount int, _ Viewer) (PaymentIntent, error) {
	// Здесь был бы вызов Bot API createInvoiceLink с provider_token.
	// Подтверждение придёт не HTTP-вебхуком от шлюза, а апдейтами боту:
	// сначала pre_checkout_query (на него надо ответить за 10 секунд),
	// потом successful_payment — вот он и переводит заказ в paid.
	return PaymentIntent{
		OrderID: orderID,
		Kind:    "invoice",
		URL:     "https://t.me/$invoice_" + orderID,
	}, nil
}

// payments выбирает провайдера под витрину. Единственное место во всём
// проекте, где вообще принимается это решение.
func (s *Server) payments(v Viewer) PaymentProvider {
	if v.IsTelegram() {
		return TelegramPayments{BotToken: s.botToken}
	}
	return WebPayments{}
}
