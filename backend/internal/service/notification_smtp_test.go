package service

import (
	"bufio"
	"fmt"
	"net"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestSendSMTPUsesSenderAsUsernameWhenPasswordIsConfigured(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen SMTP test server: %v", err)
	}
	defer listener.Close()

	serverErr := make(chan error, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			serverErr <- acceptErr
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		reader, writer := bufio.NewReader(conn), bufio.NewWriter(conn)
		write := func(reply string) error {
			if _, err := writer.WriteString(reply + "\r\n"); err != nil {
				return err
			}
			return writer.Flush()
		}
		read := func(prefix string) (string, error) {
			line, err := reader.ReadString('\n')
			if err != nil {
				return "", err
			}
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, prefix) {
				return "", fmt.Errorf("expected %s, got %s", prefix, line)
			}
			return line, nil
		}

		if err := write("220 localhost ESMTP"); err != nil {
			serverErr <- err
			return
		}
		if _, err := read("EHLO "); err != nil {
			serverErr <- err
			return
		}
		if err := write("250-localhost\r\n250-AUTH PLAIN\r\n250 OK"); err != nil {
			serverErr <- err
			return
		}
		if _, err := read("AUTH PLAIN "); err != nil {
			serverErr <- err
			return
		}
		if err := write("235 Authentication successful"); err != nil {
			serverErr <- err
			return
		}
		if _, err := read("MAIL FROM:"); err != nil {
			serverErr <- err
			return
		}
		if err := write("250 Sender OK"); err != nil {
			serverErr <- err
			return
		}
		if _, err := read("RCPT TO:"); err != nil {
			serverErr <- err
			return
		}
		if err := write("250 Recipient OK"); err != nil {
			serverErr <- err
			return
		}
		if _, err := read("DATA"); err != nil {
			serverErr <- err
			return
		}
		if err := write("354 End data with <CR><LF>.<CR><LF>"); err != nil {
			serverErr <- err
			return
		}
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				serverErr <- err
				return
			}
			if strings.TrimSpace(line) == "." {
				break
			}
		}
		if err := write("250 Message accepted"); err != nil {
			serverErr <- err
			return
		}
		if _, err := read("QUIT"); err != nil {
			serverErr <- err
			return
		}
		serverErr <- write("221 Bye")
	}()

	port := listener.Addr().(*net.TCPAddr).Port
	err = sendSMTP(t.Context(), map[string]interface{}{
		"host":     "127.0.0.1",
		"port":     port,
		"from":     "sender@example.com",
		"password": "smtp-authorization-code",
		"to":       []string{"recipient@example.com"},
		"starttls": false,
	}, "test subject", "test body")
	if err != nil {
		t.Fatalf("send SMTP with implicit sender username: %v", err)
	}
	if err := <-serverErr; err != nil {
		t.Fatalf("SMTP server assertion: %v", err)
	}

}

func TestNormalizeNotificationChannelValidatesQQSMTPCredentials(t *testing.T) {
	base := NotificationChannelInput{
		Name: "QQ 邮箱",
		Type: NotificationChannelEmail,
		Config: map[string]interface{}{
			"host":     "smtp.qq.com",
			"port":     465,
			"from":     "sender@qq.com",
			"password": "smtp-auth-code",
		},
	}

	invalid := base
	invalid.Config = map[string]interface{}{
		"host":     "smtp.qq.com",
		"port":     465,
		"from":     "sender@qq.com",
		"username": "display-name",
		"password": "smtp-auth-code",
	}
	if _, _, _, err := normalizeNotificationChannel(invalid); err == nil || !strings.Contains(err.Error(), "完整邮箱地址") {
		t.Fatalf("expected QQ username validation error, got %v", err)
	}

	if _, _, _, err := normalizeNotificationChannel(base); err != nil {
		t.Fatalf("full sender address should be accepted as the QQ username fallback: %v", err)
	}
}

func TestNormalizeRecipientsSupportsWhitespaceAndSemicolonSeparators(t *testing.T) {
	got := normalizeRecipients([]string{"first@example.com; second@example.com third@example.com, FIRST@example.com，fourth@example.com；fifth@example.com"})
	want := []string{"first@example.com", "second@example.com", "third@example.com", "fourth@example.com", "fifth@example.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeRecipients() = %#v, want %#v", got, want)
	}
}
