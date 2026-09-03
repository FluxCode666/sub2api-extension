package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestParseInvoicePagination(t *testing.T) {
	if page, err := ParseInvoicePage(""); err != nil || page != 1 {
		t.Fatalf("default page = %d, %v", page, err)
	}
	if size, err := ParseInvoicePageSize("", 5); err != nil || size != 5 {
		t.Fatalf("default page size = %d, %v", size, err)
	}
	for _, value := range []string{"0", "-1", "1000001", "not-a-number"} {
		if _, err := ParseInvoicePage(value); err == nil {
			t.Errorf("ParseInvoicePage(%q) should fail", value)
		}
	}
	for _, value := range []string{"0", "201", "not-a-number"} {
		if _, err := ParseInvoicePageSize(value, 20); err == nil {
			t.Errorf("ParseInvoicePageSize(%q) should fail", value)
		}
	}
}

func TestParseInvoiceDate(t *testing.T) {
	parsed, err := ParseInvoiceDate("2026-08-31")
	if err != nil {
		t.Fatal(err)
	}
	if !parsed.Equal(time.Date(2026, time.August, 31, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected parsed date: %s", parsed)
	}
	if _, err := ParseInvoiceDate("2026/08/31"); err == nil {
		t.Fatal("invalid date should fail")
	}
}

func TestSearchSub2APIUsersRequiresConfiguredSource(t *testing.T) {
	svc := &InvoiceService{}
	_, err := svc.SearchSub2APIUsers(context.Background(), "user@example.com", 20)
	if !errors.Is(err, ErrSub2APIDatabaseUnavailable) {
		t.Fatalf("expected database unavailable, got %v", err)
	}
}

func TestValidateInvoiceInputRequiresSingleOrder(t *testing.T) {
	base := InvoiceRequestInput{
		InvoiceTitle: "Acme",
		TaxpayerID:   "91310000",
		ContactEmail: "billing@acme.example",
	}

	for _, orderIDs := range [][]int64{nil, {}, {101, 102}} {
		input := base
		input.OrderIDs = orderIDs
		if err := validateInvoiceInput(input); err == nil {
			t.Fatalf("validateInvoiceInput(%v) should reject order selection", orderIDs)
		}
	}

	valid := base
	valid.OrderIDs = []int64{101}
	if err := validateInvoiceInput(valid); err != nil {
		t.Fatalf("single order should be accepted: %v", err)
	}
}
