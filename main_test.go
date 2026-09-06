package klubok_2

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testToken = "123456:AA-TEST-BOT-TOKEN"

// signInitData собирает initData так, как это делает сам Telegram, —
// чтобы проверять валидатор против настоящего алгоритма, а не против себя же.
func signInitData(t *testing.T, pairs map[string]string) string {
	t.Helper()

	keys := make([]string, 0, len(pairs))
	for k := range pairs {
		keys = append(keys, k)
	}
	// сортировка ключей
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[j] < keys[i] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}

	var parts []string
	for _, k := range keys {
		parts = append(parts, k+"="+pairs[k])
	}

	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(testToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(strings.Join(parts, "\n")))

	q := url.Values{}
	for k, v := range pairs {
		q.Set(k, v)
	}
	q.Set("hash", hex.EncodeToString(mac.Sum(nil)))
	return q.Encode()
}

func TestVerifyInitData_Valid(t *testing.T) {
	raw := signInitData(t, map[string]string{
		"user":      `{"id":42,"first_name":"Аня"}`,
		"auth_date": fmt.Sprint(time.Now().Unix()),
		"query_id":  "AAH-test",
		"chat_type": "private",
	})

	vals, err := VerifyInitData(raw, testToken, 24*time.Hour)
	if err != nil {
		t.Fatalf("валидная подпись отклонена: %v", err)
	}
	if !strings.Contains(vals.Get("user"), `"id":42`) {
		t.Fatalf("user не разобрался: %q", vals.Get("user"))
	}
}

func TestVerifyInitData_Tampered(t *testing.T) {
	raw := signInitData(t, map[string]string{
		"user":      `{"id":42}`,
		"auth_date": fmt.Sprint(time.Now().Unix()),
	})

	// Подменяем пользователя, оставив чужую подпись — классическая попытка
	// представиться другим человеком.
	tampered := strings.Replace(raw, "42", "99", 1)
	if _, err := VerifyInitData(tampered, testToken, 24*time.Hour); err == nil {
		t.Fatal("подделанные данные приняты — это дыра в авторизации")
	}
}

func TestVerifyInitData_WrongToken(t *testing.T) {
	raw := signInitData(t, map[string]string{
		"user":      `{"id":42}`,
		"auth_date": fmt.Sprint(time.Now().Unix()),
	})
	if _, err := VerifyInitData(raw, "999:OTHER-TOKEN", 24*time.Hour); err == nil {
		t.Fatal("подпись чужого бота принята")
	}
}

func TestVerifyInitData_Expired(t *testing.T) {
	old := time.Now().Add(-48 * time.Hour).Unix()
	raw := signInitData(t, map[string]string{
		"user":      `{"id":42}`,
		"auth_date": fmt.Sprint(old),
	})
	if _, err := VerifyInitData(raw, testToken, 24*time.Hour); err == nil {
		t.Fatal("просроченная подпись принята")
	}
}

func TestVerifyInitData_NoHash(t *testing.T) {
	if _, err := VerifyInitData("user=%7B%7D&auth_date=1", testToken, time.Hour); err == nil {
		t.Fatal("данные без hash приняты")
	}
}

func TestCartStore(t *testing.T) {
	s := NewCartStore()
	s.Add("sess", "kc-fox")
	s.Add("sess", "kc-fox") // повтор не должен удваивать — изделие одно
	s.Add("sess", "sc-moss")

	count, sum := s.Total("sess")
	if count != 2 {
		t.Fatalf("позиций в корзине = %d, ожидалось 2", count)
	}
	if sum != 890+5400 {
		t.Fatalf("сумма = %d, ожидалось %d", sum, 890+5400)
	}

	// Корзины разных сессий не должны пересекаться.
	if c, _ := s.Total("other"); c != 0 {
		t.Fatalf("чужая сессия видит %d позиций", c)
	}

	s.Remove("sess", "kc-fox")
	if c, _ := s.Total("sess"); c != 1 {
		t.Fatalf("после удаления осталось %d позиций", c)
	}
}

func TestFormatRub(t *testing.T) {
	cases := map[int]string{890: "890\u00a0₽", 5400: "5\u00a0400\u00a0₽", 7800: "7\u00a0800\u00a0₽"}
	for in, want := range cases {
		if got := formatRub(in); got != want {
			t.Errorf("formatRub(%d) = %q, ожидалось %q", in, got, want)
		}
	}
}
