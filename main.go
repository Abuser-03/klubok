package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed templates
var templateFS embed.FS

// ---------------------------------------------------------------------------
// Модель
// ---------------------------------------------------------------------------

// Product — изделие ручной работы. Каждое в одном экземпляре, поэтому
// InStock здесь bool, а не количество.
type Product struct {
	ID        string
	Title     string
	Category  string // "keychain" | "scarf"
	Technique string
	Price     int // в рублях, целыми
	Blurb     string
	Wool      string // основной цвет войлока (hex) — им рисуется иллюстрация
	Accent    string // цвет крапа/деталей
	Art       string // имя иллюстрации в art.html: fox, loaf, owl, mouse, hedgehog, moss, cobweb, stole, bactus
	Size      string // «7 см», «160 × 28 см»
	Material  string // «меринос 18 мкм», «кардочёс»
	InStock   bool
}

func (p Product) PriceFmt() string { return formatRub(p.Price) }

func (p Product) CategoryName() string {
	if p.Category == "scarf" {
		return "Шарфы"
	}
	return "Брелки"
}

// Workshop — мастер-класс.
//
// Дата не хранится строкой намеренно. Захардкоженное «20 сентября» через две
// недели превращается в прошедшую дату, и страница начинает работать против
// себя: человек видит, что объявление протухло, и уходит. Здесь задаётся день
// недели и час, а конкретная дата считается от сегодняшней.
type Workshop struct {
	ID         string
	Title      string
	Weekday    time.Weekday
	Hour       int
	Duration   string
	Price      int
	Seats      int // осталось свободных
	SeatsTotal int
	Summary    string
	Takeaway   string
	CompareID  string // изделие, с ценой которого сравниваем
}

func (w Workshop) PriceFmt() string { return formatRub(w.Price) }

// Next — ближайшее занятие. Если сегодня как раз этот день недели, но час
// уже прошёл, отдаём следующую неделю: записывать на занятие, которое
// началось два часа назад, бессмысленно.
func (w Workshop) Next() time.Time {
	now := time.Now()
	days := (int(w.Weekday) - int(now.Weekday()) + 7) % 7
	next := time.Date(now.Year(), now.Month(), now.Day()+days, w.Hour, 0, 0, 0, now.Location())
	if !next.After(now) {
		next = next.AddDate(0, 0, 7)
	}
	return next
}

// SoonFmt печатает срок словами. «Через 0 дн.» выглядит как поломка,
// хотя означает «сегодня» — а это самая сильная строчка из возможных.
func (w Workshop) SoonFmt() string {
	switch d := w.DaysLeft(); {
	case d <= 0:
		return "сегодня"
	case d == 1:
		return "завтра"
	case d < 5:
		return fmt.Sprintf("через %d дня", d)
	default:
		return fmt.Sprintf("через %d дней", d)
	}
}

func (w Workshop) DaysLeft() int {
	return int(time.Until(w.Next()).Hours() / 24)
}

// WhenFmt печатает «в субботу, 12 сентября, в 12:00».
func (w Workshop) WhenFmt() string {
	t := w.Next()
	return fmt.Sprintf("%s, %d %s, в %d:00", weekdayRu[t.Weekday()], t.Day(), monthRu[t.Month()], w.Hour)
}

// SeatsTaken нужен шаблону, чтобы нарисовать занятые места точками.
func (w Workshop) SeatsTaken() []int {
	n := w.SeatsTotal - w.Seats
	if n < 0 {
		n = 0
	}
	return make([]int, n)
}

func (w Workshop) SeatsFree() []int { return make([]int, w.Seats) }

// Compare — изделие, с ценой которого сравнивается мастер-класс. Шарф стоит
// дороже занятия, на котором его валяют, и это лучший аргумент из всех:
// человек уносит и вещь, и умение сделать следующую.
func (w Workshop) Compare() (Product, bool) { return productByID(w.CompareID) }

// CompareTitle — название изделия для сравнения. Шаблон не может вызвать
// Compare() напрямую: методы с двумя возвращаемыми значениями допускаются
// только в паре со вторым error, а там bool.
func (w Workshop) CompareTitle() string {
	p, ok := productByID(w.CompareID)
	if !ok {
		return ""
	}
	return p.Title
}

func (w Workshop) Saving() string {
	p, ok := productByID(w.CompareID)
	if !ok || p.Price <= w.Price {
		return ""
	}
	return formatRub(p.Price - w.Price)
}

var weekdayRu = map[time.Weekday]string{
	time.Monday: "в понедельник", time.Tuesday: "во вторник", time.Wednesday: "в среду",
	time.Thursday: "в четверг", time.Friday: "в пятницу", time.Saturday: "в субботу",
	time.Sunday: "в воскресенье",
}

var monthRu = map[time.Month]string{
	time.January: "января", time.February: "февраля", time.March: "марта",
	time.April: "апреля", time.May: "мая", time.June: "июня",
	time.July: "июля", time.August: "августа", time.September: "сентября",
	time.October: "октября", time.November: "ноября", time.December: "декабря",
}

// CartLine — строка корзины для рендера.
type CartLine struct {
	Product Product
	Qty     int
	Sum     int
}

func (c CartLine) SumFmt() string { return formatRub(c.Sum) }

// formatRub печатает 5400 как "5 400 ₽" — с неразрывным пробелом,
// чтобы цена не переносилась на новую строку внутри карточки.
func formatRub(v int) string {
	s := strconv.Itoa(v)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteString("\u00a0")
		}
		b.WriteRune(r)
	}
	b.WriteString("\u00a0₽")
	return b.String()
}

// ---------------------------------------------------------------------------
// Каталог (заглушка вместо БД)
// ---------------------------------------------------------------------------

var catalog = []Product{
	{
		ID: "kc-fox", Title: "Лисёнок", Category: "keychain",
		Technique: "Сухое валяние", Price: 890,
		Blurb: "Семь сантиметров, набит шерстью целиком, хвост держит форму без каркаса.",
		Wool:  "#B4552E", Accent: "#F0EBE1",
		Art: "fox", Size: "7 см", Material: "кардочёс, стеклянные бусины", InStock: true,
	},
	{
		ID: "kc-cat", Title: "Кот-батон", Category: "keychain",
		Technique: "Сухое валяние", Price: 850,
		Blurb: "Длинный, слегка недовольный. Карабин вшит в загривок, не выдёргивается.",
		Wool:  "#6E6A62", Accent: "#2E3A2B",
		Art: "loaf", Size: "9 см", Material: "кардочёс", InStock: true,
	},
	{
		ID: "kc-owl", Title: "Совушка", Category: "keychain",
		Technique: "Сухое валяние", Price: 780,
		Blurb: "Глаза — стеклянные бусины на нитке, не отваливаются в кармане.",
		Wool:  "#8A7A54", Accent: "#E8DFC8",
		Art: "owl", Size: "6 см", Material: "кардочёс, стеклянные бусины", InStock: true,
	},
	{
		ID: "kc-mouse", Title: "Мышь с сыром", Category: "keychain",
		Technique: "Сухое валяние", Price: 920,
		Blurb: "Сыр снимается — под ним ещё одна мышь. Так вышло случайно, оставила.",
		Wool:  "#9C9288", Accent: "#C9A227",
		Art: "mouse", Size: "5 см + сыр", Material: "кардочёс", InStock: true,
	},
	{
		ID: "kc-hedgehog", Title: "Ёжик", Category: "keychain",
		Technique: "Сухое валяние", Price: 800,
		Blurb: "Иголки из жёсткой новозеландской шерсти, поэтому колется по-настоящему.",
		Wool:  "#4A4239", Accent: "#D8C9A8",
		Art: "hedgehog", Size: "6 см", Material: "кардочёс, новозеландская шерсть", InStock: false,
	},
	{
		ID: "sc-moss", Title: "Северный мох", Category: "scarf",
		Technique: "Мокрое валяние", Price: 5400,
		Blurb: "Меринос 18 микрон, 160 см. Плотный, держит форму на плечах, не сползает.",
		Wool:  "#4A5D3F", Accent: "#8C9E6E",
		Art: "moss", Size: "160 × 28 см", Material: "меринос 18 мкм", InStock: true,
	},
	{
		ID: "sc-frost", Title: "Паутинка «Иней»", Category: "scarf",
		Technique: "Мокрое валяние", Price: 6200,
		Blurb: "Просвечивает на солнце, весит 48 граммов. Проходит сквозь обручальное кольцо.",
		Wool:  "#7E8CA0", Accent: "#E4E9EF",
		Art: "cobweb", Size: "180 × 40 см", Material: "меринос 16 мкм, 48 г", InStock: true,
	},
	{
		ID: "sc-madder", Title: "Палантин «Марена»", Category: "scarf",
		Technique: "Мокрое валяние", Price: 7800,
		Blurb: "Шерсть крашена корнем марены, поэтому цвет неровный и живой.",
		Wool:  "#7C3247", Accent: "#C88A97",
		Art: "stole", Size: "200 × 70 см", Material: "меринос 18 мкм, крашен мареной", InStock: true,
	},
	{
		ID: "sc-ochre", Title: "Бактус «Охра»", Category: "scarf",
		Technique: "Мокрое валяние", Price: 3900,
		Blurb: "Треугольный, короткий. Носится под пальто, узлом вперёд.",
		Wool:  "#B07C2A", Accent: "#EBD9AE",
		Art: "bactus", Size: "140 × 45 см", Material: "меринос 18 мкм", InStock: true,
	},
}

var workshops = []Workshop{
	{
		ID: "ws-dry", Title: "Сухое валяние: брелок за три часа",
		Weekday: time.Saturday, Hour: 12, Duration: "3 часа",
		Price: 2500, Seats: 2, SeatsTotal: 6, CompareID: "kc-mouse",
		Summary:  "Разбираем, почему шерсть вообще сцепляется, и валяем первую фигурку от ленты до карабина.",
		Takeaway: "Уносите свой брелок и набор игл",
	},
	{
		ID: "ws-wet", Title: "Мокрое валяние: шарф-паутинка",
		Weekday: time.Sunday, Hour: 11, Duration: "5 часов",
		Price: 4500, Seats: 1, SeatsTotal: 4, CompareID: "sc-frost",
		Summary:  "Раскладка руна, мыльный раствор, притирка и валка. Длинно, мокро и очень медитативно.",
		Takeaway: "Уносите готовый шарф 150 см",
	},
}

// stockLeft — сколько изделий ещё можно купить. Вещи в одном экземпляре,
// поэтому цифра честная и работает лучше любого «успей купить».
func stockLeft() (left, total int) {
	for _, p := range catalog {
		total++
		if p.InStock {
			left++
		}
	}
	return
}

func productByID(id string) (Product, bool) {
	for _, p := range catalog {
		if p.ID == id {
			return p, true
		}
	}
	return Product{}, false
}

func filterCatalog(cat string) []Product {
	if cat == "" || cat == "all" {
		return catalog
	}
	out := make([]Product, 0, len(catalog))
	for _, p := range catalog {
		if p.Category == cat {
			out = append(out, p)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Корзина: in-memory, ключ — id сессии из cookie.
// В реальном проекте здесь Redis или таблица в Postgres.
// ---------------------------------------------------------------------------

type CartStore struct {
	mu    sync.RWMutex
	carts map[string]map[string]int // sessionID -> productID -> qty
}

func NewCartStore() *CartStore {
	return &CartStore{carts: make(map[string]map[string]int)}
}

func (s *CartStore) Add(session, productID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.carts[session] == nil {
		s.carts[session] = make(map[string]int)
	}
	// Изделия в одном экземпляре, поэтому больше единицы в корзину не кладём.
	s.carts[session][productID] = 1
}

func (s *CartStore) Remove(session, productID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.carts[session]; ok {
		delete(c, productID)
	}
}

func (s *CartStore) Lines(session string) []CartLine {
	s.mu.RLock()
	defer s.mu.RUnlock()
	raw, ok := s.carts[session]
	if !ok {
		return nil
	}
	lines := make([]CartLine, 0, len(raw))
	for id, qty := range raw {
		p, found := productByID(id)
		if !found {
			continue
		}
		lines = append(lines, CartLine{Product: p, Qty: qty, Sum: p.Price * qty})
	}
	// Стабильный порядок, иначе htmx-swap будет каждый раз тасовать список.
	sort.Slice(lines, func(i, j int) bool { return lines[i].Product.ID < lines[j].Product.ID })
	return lines
}

func (s *CartStore) Total(session string) (count, sum int) {
	for _, l := range s.Lines(session) {
		count += l.Qty
		sum += l.Sum
	}
	return
}

// ---------------------------------------------------------------------------
// Проверка Telegram initData
//
// Telegram отдаёт в Mini App строку initData, подписанную ключом бота.
// Без этой проверки любой может постучаться в наши хендлеры и представиться
// кем угодно — именно поэтому user_id из initData нельзя брать на веру,
// пока не сошёлся HMAC.
// ---------------------------------------------------------------------------

var errBadSignature = errors.New("initData: подпись не сошлась")

func VerifyInitData(initData, botToken string, maxAge time.Duration) (url.Values, error) {
	values, err := url.ParseQuery(initData)
	if err != nil {
		return nil, fmt.Errorf("initData: не разбирается как query-строка: %w", err)
	}

	got := values.Get("hash")
	if got == "" {
		return nil, errors.New("initData: нет поля hash")
	}

	// data_check_string — все пары кроме hash, отсортированные по ключу,
	// склеенные через \n.
	keys := make([]string, 0, len(values))
	for k := range values {
		if k == "hash" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(values.Get(k))
	}

	// Двухступенчатый HMAC: сначала секрет из токена бота, потом сама подпись.
	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(botToken))

	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(b.String()))
	want := hex.EncodeToString(mac.Sum(nil))

	// Сравнение строго constant-time, иначе подпись подбирается по таймингам.
	if !hmac.Equal([]byte(want), []byte(got)) {
		return nil, errBadSignature
	}

	// Протухшую подпись не принимаем, иначе перехваченный initData живёт вечно.
	if raw := values.Get("auth_date"); raw != "" && maxAge > 0 {
		ts, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return nil, errors.New("initData: auth_date не число")
		}
		if time.Since(time.Unix(ts, 0)) > maxAge {
			return nil, errors.New("initData: подпись просрочена")
		}
	}

	return values, nil
}

// ---------------------------------------------------------------------------
// Сервер
// ---------------------------------------------------------------------------

type Server struct {
	tpl      *template.Template
	carts    *CartStore
	botToken string
}

type pageData struct {
	Viewer     Viewer
	StockLeft  int
	StockTotal int
	Products   []Product
	Workshops  []Workshop
	Category   string
	CartLines  []CartLine
	CartCount  int
	CartSum    string
	CartEmpty  bool
}

func (s *Server) page(v Viewer, cat string) pageData {
	lines := s.carts.Lines(v.Ref)
	count, sum := s.carts.Total(v.Ref)
	left, total := stockLeft()
	return pageData{
		Viewer:     v,
		StockLeft:  left,
		StockTotal: total,
		Products:   filterCatalog(cat),
		Workshops:  workshops,
		Category:   cat,
		CartLines:  lines,
		CartCount:  count,
		CartSum:    formatRub(sum),
		CartEmpty:  len(lines) == 0,
	}
}

// sessionID достаёт или заводит cookie сессии.
func sessionID(w http.ResponseWriter, r *http.Request) string {
	const name = "klubok_sid"
	if c, err := r.Cookie(name); err == nil && c.Value != "" {
		return c.Value
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// Криптослучайность недоступна — падать нельзя, но и молча
		// раздавать предсказуемые сессии тоже.
		log.Printf("rand.Read: %v", err)
	}
	id := hex.EncodeToString(buf)
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   60 * 60 * 24 * 30,
	})
	return id
}

func (s *Server) render(w http.ResponseWriter, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.tpl.ExecuteTemplate(w, name, data); err != nil {
		log.Printf("render %s: %v", name, err)
		http.Error(w, "Страница не собралась. Обновите её через пару секунд.", http.StatusInternalServerError)
	}
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	v := s.viewerFrom(w, r)
	s.render(w, v.shell(), s.page(v, "all"))
}

// handleCatalog отдаёт только сетку товаров — htmx подменит ей содержимое
// секции, полная страница здесь не нужна.
func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	v := s.viewerFrom(w, r)
	cat := r.URL.Query().Get("cat")
	if cat != "keychain" && cat != "scarf" {
		cat = "all"
	}
	s.render(w, "grid.html", s.page(v, cat))
}

func (s *Server) handleCartAdd(w http.ResponseWriter, r *http.Request) {
	v := s.viewerFrom(w, r)
	id := r.PathValue("id")
	p, ok := productByID(id)
	if !ok {
		http.Error(w, "Такого изделия нет в каталоге.", http.StatusNotFound)
		return
	}
	if !p.InStock {
		http.Error(w, "Это изделие уже продано.", http.StatusConflict)
		return
	}
	s.carts.Add(v.Ref, id)
	// Возвращаем корзину; счётчик в шапке обновится out-of-band свопом.
	s.render(w, "cart.html", s.page(v, "all"))
}

func (s *Server) handleCartRemove(w http.ResponseWriter, r *http.Request) {
	v := s.viewerFrom(w, r)
	s.carts.Remove(v.Ref, r.PathValue("id"))
	s.render(w, "cart.html", s.page(v, "all"))
}

func (s *Server) handleCart(w http.ResponseWriter, r *http.Request) {
	v := s.viewerFrom(w, r)
	s.render(w, "cart.html", s.page(v, "all"))
}

// handleCheckout — точка, где начинается платёжный цикл: создаём заказ
// у себя, и только потом пошли бы в платёжный шлюз.
func (s *Server) handleCheckout(w http.ResponseWriter, r *http.Request) {
	v := s.viewerFrom(w, r)

	lines := s.carts.Lines(v.Ref)
	if len(lines) == 0 {
		http.Error(w, "Корзина пуста.", http.StatusBadRequest)
		return
	}

	_, sum := s.carts.Total(v.Ref)
	orderID := newOrderID()

	// Здесь была бы вставка заказа в БД со статусом pending, idempotency_key
	// и колонка source = v.Surface — заказы с обеих витрин лежат в одной
	// таблице, иначе потом невозможно посчитать выручку одним запросом.
	log.Printf("заказ %s создан: витрина=%s, владелец=%s, %d позиций, %d ₽",
		orderID, v.Surface, v.Ref, len(lines), sum)

	// Единственная развилка: чем показать окно оплаты. Сам заказ,
	// сумма и корзина до этого момента считались одинаково.
	intent, err := s.payments(v).Start(orderID, sum, v)
	if err != nil {
		log.Printf("оплата не стартовала: %v", err)
		http.Error(w, "Не удалось открыть оплату. Попробуйте ещё раз.", http.StatusBadGateway)
		return
	}

	s.render(w, "checkout.html", map[string]any{
		"OrderID": orderID,
		"Sum":     formatRub(sum),
		"Lines":   lines,
		"Intent":  intent,
		"Viewer":  v,
	})
}

func (s *Server) handleWorkshopSignup(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Форма не разобралась.", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(r.FormValue("name"))
	contact := strings.TrimSpace(r.FormValue("contact"))
	wsID := r.FormValue("workshop")

	// Валидация на сервере: клиентскую можно обойти, а место на мастер-классе
	// физически одно.
	var problems []string
	if name == "" {
		problems = append(problems, "Напишите, как вас зовут")
	}
	if contact == "" {
		problems = append(problems, "Оставьте телеграм или телефон для связи")
	}
	var chosen Workshop
	var found bool
	for _, ws := range workshops {
		if ws.ID == wsID {
			chosen, found = ws, true
		}
	}
	if !found {
		problems = append(problems, "Выберите мастер-класс")
	}

	if len(problems) > 0 {
		w.WriteHeader(http.StatusUnprocessableEntity)
		s.render(w, "signup-error.html", map[string]any{"Problems": problems})
		return
	}

	log.Printf("запись на %s: %s (%s)", chosen.ID, name, contact)
	s.render(w, "signup-ok.html", map[string]any{"Name": name, "Workshop": chosen})
}

func newOrderID() string {
	buf := make([]byte, 4)
	_, _ = rand.Read(buf)
	return fmt.Sprintf("K-%s-%s", time.Now().Format("0102"), strings.ToUpper(hex.EncodeToString(buf)))
}

// ---------------------------------------------------------------------------

func main() {
	tpl, err := template.ParseFS(templateFS, "templates/*.html", "templates/partials/*.html")
	if err != nil {
		log.Fatalf("шаблоны не собрались: %v", err)
	}

	srv := &Server{
		tpl:      tpl,
		carts:    NewCartStore(),
		botToken: os.Getenv("BOT_TOKEN"), // пусто — проверка initData пропускается
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", srv.handleIndex)
	mux.HandleFunc("GET /catalog", srv.handleCatalog)
	mux.HandleFunc("GET /cart", srv.handleCart)
	mux.HandleFunc("POST /cart/add/{id}", srv.handleCartAdd)
	mux.HandleFunc("POST /cart/remove/{id}", srv.handleCartRemove)
	mux.HandleFunc("POST /checkout", srv.handleCheckout)
	mux.HandleFunc("POST /workshop/signup", srv.handleWorkshopSignup)
	mux.Handle("GET /static/", http.StripPrefix("/static/", staticHandler()))

	addr := ":" + envOr("PORT", "8080")
	log.Printf("Клубок слушает http://localhost%s", addr)
	// Сжатие оборачивает всё разом: и шаблоны, и статику.
	if err := http.ListenAndServe(addr, withGzip(mux)); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
