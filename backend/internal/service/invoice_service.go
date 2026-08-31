package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"sub2api-extension/ent"
	"sub2api-extension/ent/invoiceorder"
	"sub2api-extension/ent/invoiceprofile"
	"sub2api-extension/ent/invoicerequest"
	"sub2api-extension/ent/systemmeta"
	"sub2api-extension/internal/invoice"
)

const InvoiceFeatureSettingKey = "invoice.feature.enabled"
const MaxInvoiceDocumentBytes int64 = 20 * 1024 * 1024

var (
	ErrInvoiceFeatureDisabled  = errors.New("invoice feature is disabled")
	ErrInvoiceNotFound         = errors.New("invoice request not found")
	ErrInvoiceOrderUnavailable = errors.New("one or more selected orders are unavailable")
	ErrInvoiceOrderAlreadyUsed = errors.New("one or more selected orders have already been invoiced")
	ErrInvoiceUserNotFound     = errors.New("sub2api user not found")
	ErrInvalidInvoiceStatus    = errors.New("invalid invoice status")
)

type InvoiceStatus string

const (
	InvoiceStatusPending    InvoiceStatus = "PENDING"
	InvoiceStatusProcessing InvoiceStatus = "PROCESSING"
	InvoiceStatusIssued     InvoiceStatus = "ISSUED"
	InvoiceStatusRejected   InvoiceStatus = "REJECTED"
)

type InvoiceOrderCandidate = invoice.OrderCandidate

type InvoiceOrderSource interface {
	ListCompletedRecharges(context.Context, int64) ([]InvoiceOrderCandidate, error)
	GetCompletedRecharges(context.Context, int64, []int64) ([]InvoiceOrderCandidate, error)
}

// InvoiceUserSource is optional so existing order-source implementations stay
// compatible when Sub2API user search is not configured.
type InvoiceUserSource interface {
	SearchUsersByEmail(context.Context, string, int) ([]invoice.UserCandidate, error)
}

// InvoiceUserLookup is kept separate from the search interface so existing
// order stores and test doubles remain source-compatible. Manual admin
// records use this lookup to trust only the identity stored in Sub2API.
type InvoiceUserLookup interface {
	GetUserByID(context.Context, int64) (invoice.UserCandidate, error)
}

type InvoiceRequestInput struct {
	InvoiceTitle      string  `json:"invoice_title"`
	TaxpayerID        string  `json:"taxpayer_id"`
	ContactEmail      string  `json:"contact_email"`
	ContactPhone      string  `json:"contact_phone"`
	RegisteredAddress string  `json:"registered_address"`
	BankName          string  `json:"bank_name"`
	BankAccount       string  `json:"bank_account"`
	Remark            string  `json:"remark"`
	OrderIDs          []int64 `json:"order_ids"`
}

// ManualInvoiceRequestInput describes an invoice record created by an
// administrator for an offline payment. It intentionally has no order IDs:
// offline transfers do not have a Sub2API payment_orders row to associate.
type ManualInvoiceRequestInput struct {
	UserID            int64         `json:"user_id"`
	InvoiceTitle      string        `json:"invoice_title"`
	TaxpayerID        string        `json:"taxpayer_id"`
	ContactEmail      string        `json:"contact_email"`
	ContactPhone      string        `json:"contact_phone"`
	RegisteredAddress string        `json:"registered_address"`
	BankName          string        `json:"bank_name"`
	BankAccount       string        `json:"bank_account"`
	Remark            string        `json:"remark"`
	Amount            float64       `json:"amount"`
	Status            InvoiceStatus `json:"status"`
	AdminNote         string        `json:"admin_note"`
}

// InvoiceProfileInput is the reusable portion of an invoice application.
// Order selection and the per-request remark are deliberately excluded.
type InvoiceProfileInput struct {
	InvoiceTitle      string `json:"invoice_title"`
	TaxpayerID        string `json:"taxpayer_id"`
	ContactEmail      string `json:"contact_email"`
	ContactPhone      string `json:"contact_phone"`
	RegisteredAddress string `json:"registered_address"`
	BankName          string `json:"bank_name"`
	BankAccount       string `json:"bank_account"`
}

type InvoiceProfile struct {
	UserID            int64     `json:"user_id,omitempty"`
	InvoiceTitle      string    `json:"invoice_title"`
	TaxpayerID        string    `json:"taxpayer_id"`
	ContactEmail      string    `json:"contact_email"`
	ContactPhone      string    `json:"contact_phone,omitempty"`
	RegisteredAddress string    `json:"registered_address,omitempty"`
	BankName          string    `json:"bank_name,omitempty"`
	BankAccount       string    `json:"bank_account,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type InvoiceRequest struct {
	ID                int                     `json:"id"`
	UserID            int64                   `json:"user_id,omitempty"`
	UserEmail         string                  `json:"user_email,omitempty"`
	UserName          string                  `json:"user_name,omitempty"`
	InvoiceTitle      string                  `json:"invoice_title"`
	TaxpayerID        string                  `json:"taxpayer_id"`
	ContactEmail      string                  `json:"contact_email"`
	ContactPhone      string                  `json:"contact_phone,omitempty"`
	RegisteredAddress string                  `json:"registered_address,omitempty"`
	BankName          string                  `json:"bank_name,omitempty"`
	BankAccount       string                  `json:"bank_account,omitempty"`
	Remark            string                  `json:"remark,omitempty"`
	Amount            float64                 `json:"amount"`
	Status            InvoiceStatus           `json:"status"`
	AdminNote         string                  `json:"admin_note,omitempty"`
	Orders            []InvoiceOrderCandidate `json:"orders"`
	DocumentAvailable bool                    `json:"document_available"`
	DocumentName      string                  `json:"document_name,omitempty"`
	IssuedAt          *time.Time              `json:"issued_at,omitempty"`
	CreatedAt         time.Time               `json:"created_at"`
	UpdatedAt         time.Time               `json:"updated_at"`
}

// InvoiceRequestPage is the paginated response shared by the user and admin
// invoice lists. The items field remains compatible with the original list API.
type InvoiceRequestPage struct {
	Items      []InvoiceRequest `json:"items"`
	Total      int              `json:"total"`
	Page       int              `json:"page"`
	PageSize   int              `json:"page_size"`
	TotalPages int              `json:"total_pages"`
}

type InvoiceAdminFilters struct {
	Page       int
	PageSize   int
	Keyword    string
	TaxpayerID string
	Status     InvoiceStatus
	UserID     int64
	StartDate  time.Time
	EndDate    time.Time
}

type InvoiceUser = invoice.UserCandidate

type entInvoiceStore struct{ client *ent.Client }

func NewEntInvoiceStore(client *ent.Client) *entInvoiceStore { return &entInvoiceStore{client: client} }

type InvoiceService struct {
	store       *entInvoiceStore
	orders      InvoiceOrderSource
	users       InvoiceUserSource
	userLookup  InvoiceUserLookup
	documentDir string
}

func NewInvoiceService(client *ent.Client, orders InvoiceOrderSource, assetDir string) *InvoiceService {
	var users InvoiceUserSource
	var userLookup InvoiceUserLookup
	if source, ok := orders.(InvoiceUserSource); ok {
		users = source
	}
	if source, ok := orders.(InvoiceUserLookup); ok {
		userLookup = source
	}
	return &InvoiceService{
		store:       NewEntInvoiceStore(client),
		orders:      orders,
		users:       users,
		userLookup:  userLookup,
		documentDir: filepath.Join(strings.TrimSpace(assetDir), "invoices"),
	}
}

func (s *InvoiceService) FeatureEnabled(ctx context.Context) (bool, error) {
	if s == nil || s.store == nil || s.store.client == nil {
		return false, errors.New("invoice store is unavailable")
	}
	meta, err := s.store.client.SystemMeta.Query().Where(systemmeta.KeyEQ(InvoiceFeatureSettingKey)).Only(ctx)
	if ent.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strings.EqualFold(strings.TrimSpace(meta.Value), "true"), nil
}

func (s *InvoiceService) SetFeatureEnabled(ctx context.Context, enabled bool) error {
	if s == nil || s.store == nil || s.store.client == nil {
		return errors.New("invoice store is unavailable")
	}
	value := "false"
	if enabled {
		value = "true"
	}
	meta, err := s.store.client.SystemMeta.Query().Where(systemmeta.KeyEQ(InvoiceFeatureSettingKey)).Only(ctx)
	if ent.IsNotFound(err) {
		_, err = s.store.client.SystemMeta.Create().SetKey(InvoiceFeatureSettingKey).SetValue(value).Save(ctx)
		return err
	}
	if err != nil {
		return err
	}
	return s.store.client.SystemMeta.UpdateOne(meta).SetValue(value).Exec(ctx)
}

func (s *InvoiceService) GetProfile(ctx context.Context, userID int64) (*InvoiceProfile, error) {
	if s == nil || s.store == nil || s.store.client == nil {
		return nil, errors.New("invoice store is unavailable")
	}
	profile, err := s.store.client.InvoiceProfile.Query().Where(invoiceprofile.UserIDEQ(userID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return mapInvoiceProfile(profile), nil
}

func (s *InvoiceService) SaveProfile(ctx context.Context, userID int64, input InvoiceProfileInput) (*InvoiceProfile, error) {
	if s == nil || s.store == nil || s.store.client == nil {
		return nil, errors.New("invoice store is unavailable")
	}
	if userID <= 0 {
		return nil, fmt.Errorf("invalid user ID")
	}
	input = normalizeInvoiceProfileInput(input)
	if err := validateInvoiceProfileInput(input); err != nil {
		return nil, err
	}
	profile, err := s.store.client.InvoiceProfile.Query().Where(invoiceprofile.UserIDEQ(userID)).Only(ctx)
	if ent.IsNotFound(err) {
		created, createErr := s.store.client.InvoiceProfile.Create().
			SetUserID(userID).
			SetInvoiceTitle(input.InvoiceTitle).
			SetTaxpayerID(input.TaxpayerID).
			SetContactEmail(input.ContactEmail).
			SetContactPhone(input.ContactPhone).
			SetRegisteredAddress(input.RegisteredAddress).
			SetBankName(input.BankName).
			SetBankAccount(input.BankAccount).
			Save(ctx)
		if createErr != nil {
			return nil, createErr
		}
		return mapInvoiceProfile(created), nil
	}
	if err != nil {
		return nil, err
	}
	updated, err := s.store.client.InvoiceProfile.UpdateOne(profile).
		SetInvoiceTitle(input.InvoiceTitle).
		SetTaxpayerID(input.TaxpayerID).
		SetContactEmail(input.ContactEmail).
		SetContactPhone(input.ContactPhone).
		SetRegisteredAddress(input.RegisteredAddress).
		SetBankName(input.BankName).
		SetBankAccount(input.BankAccount).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	return mapInvoiceProfile(updated), nil
}

func (s *InvoiceService) ListEligibleOrders(ctx context.Context, userID int64) ([]InvoiceOrderCandidate, error) {
	if s == nil || s.orders == nil {
		return nil, ErrSub2APIDatabaseUnavailable
	}
	enabled, err := s.FeatureEnabled(ctx)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, ErrInvoiceFeatureDisabled
	}
	items, err := s.orders.ListCompletedRecharges(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSub2APIDatabaseUnavailable, err)
	}
	locked, err := s.lockedOrderIDs(ctx, items)
	if err != nil {
		return nil, err
	}
	result := make([]InvoiceOrderCandidate, 0, len(items))
	for _, item := range items {
		if !locked[item.PaymentOrderID] {
			result = append(result, item)
		}
	}
	return result, nil
}

func (s *InvoiceService) Create(ctx context.Context, userID int64, email, name string, input InvoiceRequestInput) (*InvoiceRequest, error) {
	if s == nil || s.orders == nil || s.store == nil || s.store.client == nil {
		return nil, ErrSub2APIDatabaseUnavailable
	}
	enabled, err := s.FeatureEnabled(ctx)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, ErrInvoiceFeatureDisabled
	}
	input = normalizeInvoiceInput(input)
	if err := validateInvoiceInput(input); err != nil {
		return nil, err
	}
	selected, err := s.orders.GetCompletedRecharges(ctx, userID, input.OrderIDs)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSub2APIDatabaseUnavailable, err)
	}
	if len(selected) != len(input.OrderIDs) {
		return nil, ErrInvoiceOrderUnavailable
	}
	byID := make(map[int64]InvoiceOrderCandidate, len(selected))
	for _, item := range selected {
		byID[item.PaymentOrderID] = item
	}
	ordered := make([]InvoiceOrderCandidate, 0, len(input.OrderIDs))
	var amount float64
	for _, id := range input.OrderIDs {
		item, ok := byID[id]
		if !ok {
			return nil, ErrInvoiceOrderUnavailable
		}
		ordered = append(ordered, item)
		amount += item.Amount
	}
	amount = roundMoney(amount)
	tx, err := s.store.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if rollbackErr := tx.Rollback(); rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			log.Printf("[InvoiceService] transaction rollback failed: %v", rollbackErr)
		}
	}()
	created, err := tx.InvoiceRequest.Create().
		SetUserID(userID).SetUserEmail(email).SetUserName(name).
		SetInvoiceTitle(input.InvoiceTitle).SetTaxpayerID(input.TaxpayerID).
		SetContactEmail(input.ContactEmail).SetContactPhone(input.ContactPhone).
		SetRegisteredAddress(input.RegisteredAddress).SetBankName(input.BankName).SetBankAccount(input.BankAccount).
		SetRemark(input.Remark).SetAmount(amount).SetStatus(string(InvoiceStatusPending)).Save(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range ordered {
		if _, err = tx.InvoiceOrder.Create().SetInvoiceRequestID(created.ID).SetPaymentOrderID(item.PaymentOrderID).
			SetOutTradeNo(item.OutTradeNo).SetAmount(item.Amount).SetPaidAt(item.PaidAt).Save(ctx); err != nil {
			if ent.IsConstraintError(err) {
				return nil, ErrInvoiceOrderAlreadyUsed
			}
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.getByID(ctx, created.ID)
}

// CreateManual creates an invoice request for an offline transfer. The
// Sub2API user is resolved by ID and the resulting email/name are snapshotted;
// caller-provided identity fields are never trusted. No invoice_orders rows
// are written because there is no corresponding online payment order.
func (s *InvoiceService) CreateManual(ctx context.Context, input ManualInvoiceRequestInput) (*InvoiceRequest, error) {
	if s == nil || s.store == nil || s.store.client == nil || s.userLookup == nil {
		return nil, ErrSub2APIDatabaseUnavailable
	}
	if input.UserID <= 0 {
		return nil, fmt.Errorf("user_id must be a positive integer")
	}
	if math.IsNaN(input.Amount) || math.IsInf(input.Amount, 0) || input.Amount <= 0 {
		return nil, fmt.Errorf("amount must be greater than zero")
	}
	if rounded := roundMoney(input.Amount); math.Abs(input.Amount-rounded) > 1e-9 {
		return nil, fmt.Errorf("amount must have at most 2 decimal places")
	}
	input.InvoiceTitle = limitText(input.InvoiceTitle, 200)
	input.TaxpayerID = strings.ToUpper(limitText(input.TaxpayerID, 64))
	input.ContactEmail = limitText(input.ContactEmail, 255)
	input.ContactPhone = limitText(input.ContactPhone, 64)
	input.RegisteredAddress = limitText(input.RegisteredAddress, 1000)
	input.BankName = limitText(input.BankName, 200)
	input.BankAccount = limitText(input.BankAccount, 128)
	input.Remark = limitText(input.Remark, 2000)
	input.AdminNote = limitText(input.AdminNote, 2000)
	if input.Status == "" {
		input.Status = InvoiceStatusPending
	}
	if input.Status != InvoiceStatusPending && input.Status != InvoiceStatusProcessing && input.Status != InvoiceStatusRejected {
		return nil, ErrInvalidInvoiceStatus
	}
	if err := validateInvoiceProfileInput(InvoiceProfileInput{
		InvoiceTitle: input.InvoiceTitle, TaxpayerID: input.TaxpayerID, ContactEmail: input.ContactEmail,
	}); err != nil {
		return nil, err
	}
	user, err := s.userLookup.GetUserByID(ctx, input.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInvoiceUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSub2APIDatabaseUnavailable, err)
	}
	if user.ID <= 0 || strings.TrimSpace(user.Email) == "" {
		return nil, ErrInvoiceUserNotFound
	}
	amount := roundMoney(input.Amount)
	if amount <= 0 {
		return nil, fmt.Errorf("amount must be greater than zero")
	}
	created, err := s.store.client.InvoiceRequest.Create().
		SetUserID(user.ID).SetUserEmail(limitText(user.Email, 255)).SetUserName(limitText(user.Username, 100)).
		SetInvoiceTitle(input.InvoiceTitle).SetTaxpayerID(input.TaxpayerID).SetContactEmail(input.ContactEmail).
		SetContactPhone(input.ContactPhone).SetRegisteredAddress(input.RegisteredAddress).SetBankName(input.BankName).
		SetBankAccount(input.BankAccount).SetRemark(input.Remark).SetAmount(amount).SetStatus(string(input.Status)).
		SetAdminNote(input.AdminNote).Save(ctx)
	if err != nil {
		return nil, err
	}
	return s.getByID(ctx, created.ID)
}

func (s *InvoiceService) ListForUser(ctx context.Context, userID int64) ([]InvoiceRequest, error) {
	if s == nil || s.store == nil || s.store.client == nil {
		return nil, errors.New("invoice store is unavailable")
	}
	entities, err := s.store.client.InvoiceRequest.Query().Where(invoicerequest.UserIDEQ(userID)).Order(ent.Desc(invoicerequest.FieldCreatedAt)).All(ctx)
	if err != nil {
		return nil, err
	}
	return s.toRequests(ctx, entities)
}

func (s *InvoiceService) ListForUserPage(ctx context.Context, userID int64, page, pageSize int) (*InvoiceRequestPage, error) {
	if s == nil || s.store == nil || s.store.client == nil {
		return nil, errors.New("invoice store is unavailable")
	}
	page, pageSize, err := normalizeInvoicePagination(page, pageSize)
	if err != nil {
		return nil, err
	}
	query := s.store.client.InvoiceRequest.Query().Where(invoicerequest.UserIDEQ(userID))
	return s.listRequestPage(ctx, query, page, pageSize)
}

func (s *InvoiceService) ListForAdmin(ctx context.Context, status string) ([]InvoiceRequest, error) {
	if s == nil || s.store == nil || s.store.client == nil {
		return nil, errors.New("invoice store is unavailable")
	}
	query := s.store.client.InvoiceRequest.Query().Order(ent.Desc(invoicerequest.FieldCreatedAt))
	if strings.TrimSpace(status) != "" {
		parsed, ok := parseInvoiceStatus(status)
		if !ok {
			return nil, ErrInvalidInvoiceStatus
		}
		query = query.Where(invoicerequest.StatusEQ(string(parsed)))
	}
	entities, err := query.All(ctx)
	if err != nil {
		return nil, err
	}
	return s.toRequests(ctx, entities)
}

func (s *InvoiceService) ListForAdminPage(ctx context.Context, filters InvoiceAdminFilters) (*InvoiceRequestPage, error) {
	if s == nil || s.store == nil || s.store.client == nil {
		return nil, errors.New("invoice store is unavailable")
	}
	page, pageSize, err := normalizeInvoicePagination(filters.Page, filters.PageSize)
	if err != nil {
		return nil, err
	}
	query := s.store.client.InvoiceRequest.Query()
	if filters.Keyword != "" {
		query = query.Where(invoicerequest.InvoiceTitleContainsFold(limitText(filters.Keyword, 200)))
	}
	if filters.TaxpayerID != "" {
		query = query.Where(invoicerequest.TaxpayerIDContainsFold(strings.ToUpper(limitText(filters.TaxpayerID, 64))))
	}
	if filters.Status != "" {
		parsed, ok := parseInvoiceStatus(string(filters.Status))
		if !ok {
			return nil, ErrInvalidInvoiceStatus
		}
		query = query.Where(invoicerequest.StatusEQ(string(parsed)))
	}
	if filters.UserID > 0 {
		query = query.Where(invoicerequest.UserIDEQ(filters.UserID))
	}
	if !filters.StartDate.IsZero() {
		query = query.Where(invoicerequest.CreatedAtGTE(filters.StartDate))
	}
	if !filters.EndDate.IsZero() {
		query = query.Where(invoicerequest.CreatedAtLT(filters.EndDate))
	}
	return s.listRequestPage(ctx, query, page, pageSize)
}

func (s *InvoiceService) listRequestPage(ctx context.Context, query *ent.InvoiceRequestQuery, page, pageSize int) (*InvoiceRequestPage, error) {
	total, err := query.Count(ctx)
	if err != nil {
		return nil, err
	}
	entities, err := query.Order(ent.Desc(invoicerequest.FieldCreatedAt), ent.Desc(invoicerequest.FieldID)).
		Offset((page - 1) * pageSize).Limit(pageSize).All(ctx)
	if err != nil {
		return nil, err
	}
	items, err := s.toRequests(ctx, entities)
	if err != nil {
		return nil, err
	}
	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	return &InvoiceRequestPage{Items: items, Total: total, Page: page, PageSize: pageSize, TotalPages: totalPages}, nil
}

func (s *InvoiceService) SearchSub2APIUsers(ctx context.Context, email string, limit int) ([]InvoiceUser, error) {
	if s == nil || s.users == nil {
		return nil, ErrSub2APIDatabaseUnavailable
	}
	email = limitText(email, 255)
	if email == "" {
		return []InvoiceUser{}, nil
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	items, err := s.users.SearchUsersByEmail(ctx, email, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSub2APIDatabaseUnavailable, err)
	}
	return items, nil
}

func normalizeInvoicePagination(page, pageSize int) (int, int, error) {
	if page <= 0 {
		page = 1
	}
	if page > 1_000_000 {
		return 0, 0, fmt.Errorf("page must be between 1 and 1000000")
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 200 {
		return 0, 0, fmt.Errorf("page_size must be between 1 and 200")
	}
	return page, pageSize, nil
}

func ParseInvoicePage(value string) (int, error) {
	if strings.TrimSpace(value) == "" {
		return 1, nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n < 1 || n > 1_000_000 {
		return 0, errors.New("page must be a positive integer")
	}
	return n, nil
}

func ParseInvoicePageSize(value string, defaultSize int) (int, error) {
	if strings.TrimSpace(value) == "" {
		return defaultSize, nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n < 1 || n > 200 {
		return 0, errors.New("page_size must be between 1 and 200")
	}
	return n, nil
}

func ParseInvoiceDate(value string) (time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return time.Time{}, nil
	}
	parsed, err := time.Parse("2006-01-02", strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid date %q: %w", value, err)
	}
	return parsed.UTC(), nil
}

func (s *InvoiceService) UpdateAdminStatus(ctx context.Context, id int, status InvoiceStatus, note string) (*InvoiceRequest, error) {
	if !isAdminStatus(status) {
		return nil, ErrInvalidInvoiceStatus
	}
	request, err := s.store.client.InvoiceRequest.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, ErrInvoiceNotFound
	}
	if err != nil {
		return nil, err
	}
	updated, err := s.store.client.InvoiceRequest.UpdateOne(request).SetStatus(string(status)).SetAdminNote(limitText(note, 2000)).Save(ctx)
	if err != nil {
		return nil, err
	}
	return s.getByID(ctx, updated.ID)
}

func (s *InvoiceService) AttachDocument(ctx context.Context, id int, originalName string, source io.Reader) (*InvoiceRequest, error) {
	if s == nil || s.store == nil || s.store.client == nil {
		return nil, errors.New("invoice store is unavailable")
	}
	if source == nil {
		return nil, fmt.Errorf("invoice document is required")
	}
	request, err := s.store.client.InvoiceRequest.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, ErrInvoiceNotFound
	}
	if err != nil {
		return nil, err
	}
	if request.Status == string(InvoiceStatusRejected) {
		return nil, fmt.Errorf("cannot issue a rejected invoice request")
	}
	cleanName, extension, mimeType, err := validateInvoiceDocumentName(originalName)
	if err != nil {
		return nil, err
	}
	// Extension is only a hint. Sniff the payload before persisting it so an
	// executable or HTML file cannot be uploaded under a document suffix.
	head, err := io.ReadAll(io.LimitReader(source, 512))
	if err != nil {
		return nil, err
	}
	detected := http.DetectContentType(head)
	if extension == ".pdf" && !bytes.HasPrefix(bytes.TrimSpace(head), []byte("%PDF-")) {
		return nil, fmt.Errorf("invoice PDF content is invalid")
	}
	if extension != ".pdf" && detected != mimeType {
		return nil, fmt.Errorf("invoice image content is invalid")
	}
	if err := os.MkdirAll(s.documentDir, 0o750); err != nil {
		return nil, err
	}
	randomPart, err := randomHex(16)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(s.documentDir, fmt.Sprintf("invoice-%d-%s%s", id, randomPart, extension))
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return nil, err
	}
	written, copyErr := io.Copy(file, io.LimitReader(io.MultiReader(bytes.NewReader(head), source), MaxInvoiceDocumentBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || written > MaxInvoiceDocumentBytes {
		if removeErr := os.Remove(path); removeErr != nil {
			log.Printf("[InvoiceService.AttachDocument] failed to remove incomplete file path=%q: %v", path, removeErr)
		}
		if written > MaxInvoiceDocumentBytes {
			return nil, fmt.Errorf("invoice document must not exceed 20MB")
		}
		if copyErr != nil {
			return nil, copyErr
		}
		return nil, closeErr
	}
	updated, err := s.store.client.InvoiceRequest.UpdateOne(request).
		SetInvoiceFileName(cleanName).SetInvoiceFilePath(filepath.Base(path)).SetInvoiceFileMimeType(mimeType).
		SetInvoiceFileSize(written).SetStatus(string(InvoiceStatusIssued)).SetIssuedAt(time.Now()).Save(ctx)
	if err != nil {
		if removeErr := os.Remove(path); removeErr != nil {
			log.Printf("[InvoiceService.AttachDocument] failed to remove orphan file path=%q: %v", path, removeErr)
		}
		return nil, err
	}
	if request.InvoiceFilePath != "" {
		oldPath := filepath.Join(s.documentDir, filepath.Base(request.InvoiceFilePath))
		if removeErr := os.Remove(oldPath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			log.Printf("[InvoiceService.AttachDocument] failed to remove previous file path=%q: %v", oldPath, removeErr)
		}
	}
	return s.getByID(ctx, updated.ID)
}

func (s *InvoiceService) OpenDocument(ctx context.Context, id int, userID *int64) (*InvoiceRequest, *os.File, error) {
	if s == nil || s.store == nil || s.store.client == nil {
		return nil, nil, errors.New("invoice store is unavailable")
	}
	entity, err := s.store.client.InvoiceRequest.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, nil, ErrInvoiceNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	if userID != nil && entity.UserID != *userID {
		return nil, nil, ErrInvoiceNotFound
	}
	if entity.InvoiceFilePath == "" {
		return nil, nil, ErrInvoiceNotFound
	}
	items, err := s.toRequests(ctx, []*ent.InvoiceRequest{entity})
	if err != nil {
		return nil, nil, err
	}
	request := &items[0]
	file, err := os.Open(filepath.Join(s.documentDir, filepath.Base(entity.InvoiceFilePath)))
	if os.IsNotExist(err) {
		return nil, nil, ErrInvoiceNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	return request, file, nil
}

func (s *InvoiceService) getByID(ctx context.Context, id int) (*InvoiceRequest, error) {
	entity, err := s.store.client.InvoiceRequest.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, ErrInvoiceNotFound
	}
	if err != nil {
		return nil, err
	}
	items, err := s.toRequests(ctx, []*ent.InvoiceRequest{entity})
	if err != nil {
		return nil, err
	}
	return &items[0], nil
}

func mapInvoiceProfile(profile *ent.InvoiceProfile) *InvoiceProfile {
	if profile == nil {
		return nil
	}
	return &InvoiceProfile{
		UserID:            profile.UserID,
		InvoiceTitle:      profile.InvoiceTitle,
		TaxpayerID:        profile.TaxpayerID,
		ContactEmail:      profile.ContactEmail,
		ContactPhone:      profile.ContactPhone,
		RegisteredAddress: profile.RegisteredAddress,
		BankName:          profile.BankName,
		BankAccount:       profile.BankAccount,
		CreatedAt:         profile.CreatedAt.UTC(),
		UpdatedAt:         profile.UpdatedAt.UTC(),
	}
}

func (s *InvoiceService) toRequests(ctx context.Context, entities []*ent.InvoiceRequest) ([]InvoiceRequest, error) {
	result := make([]InvoiceRequest, 0, len(entities))
	for _, entity := range entities {
		orders, err := s.store.client.InvoiceOrder.Query().Where(invoiceorder.InvoiceRequestIDEQ(entity.ID)).Order(ent.Asc(invoiceorder.FieldID)).All(ctx)
		if err != nil {
			return nil, err
		}
		mappedOrders := make([]InvoiceOrderCandidate, 0, len(orders))
		for _, order := range orders {
			var paidAt time.Time
			if order.PaidAt != nil {
				paidAt = order.PaidAt.UTC()
			}
			mappedOrders = append(mappedOrders, InvoiceOrderCandidate{PaymentOrderID: order.PaymentOrderID, OutTradeNo: order.OutTradeNo, Amount: order.Amount, PaidAt: paidAt})
		}
		var issuedAt *time.Time
		if entity.IssuedAt != nil {
			value := entity.IssuedAt.UTC()
			issuedAt = &value
		}
		result = append(result, InvoiceRequest{ID: entity.ID, UserID: entity.UserID, UserEmail: entity.UserEmail, UserName: entity.UserName, InvoiceTitle: entity.InvoiceTitle, TaxpayerID: entity.TaxpayerID, ContactEmail: entity.ContactEmail, ContactPhone: entity.ContactPhone, RegisteredAddress: entity.RegisteredAddress, BankName: entity.BankName, BankAccount: entity.BankAccount, Remark: entity.Remark, Amount: entity.Amount, Status: InvoiceStatus(entity.Status), AdminNote: entity.AdminNote, Orders: mappedOrders, DocumentAvailable: entity.InvoiceFilePath != "", DocumentName: entity.InvoiceFileName, IssuedAt: issuedAt, CreatedAt: entity.CreatedAt.UTC(), UpdatedAt: entity.UpdatedAt.UTC()})
	}
	return result, nil
}

func (s *InvoiceService) lockedOrderIDs(ctx context.Context, candidates []InvoiceOrderCandidate) (map[int64]bool, error) {
	locked := make(map[int64]bool)
	if len(candidates) == 0 {
		return locked, nil
	}
	ids := make([]int64, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.PaymentOrderID)
	}
	items, err := s.store.client.InvoiceOrder.Query().Where(invoiceorder.PaymentOrderIDIn(ids...)).All(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		locked[item.PaymentOrderID] = true
	}
	return locked, nil
}

func normalizeInvoiceInput(input InvoiceRequestInput) InvoiceRequestInput {
	input.InvoiceTitle = limitText(input.InvoiceTitle, 200)
	input.TaxpayerID = strings.ToUpper(limitText(input.TaxpayerID, 64))
	input.ContactEmail = limitText(input.ContactEmail, 255)
	input.ContactPhone = limitText(input.ContactPhone, 64)
	input.RegisteredAddress = limitText(input.RegisteredAddress, 1000)
	input.BankName = limitText(input.BankName, 200)
	input.BankAccount = limitText(input.BankAccount, 128)
	input.Remark = limitText(input.Remark, 2000)
	return input
}

func normalizeInvoiceProfileInput(input InvoiceProfileInput) InvoiceProfileInput {
	input.InvoiceTitle = limitText(input.InvoiceTitle, 200)
	input.TaxpayerID = strings.ToUpper(limitText(input.TaxpayerID, 64))
	input.ContactEmail = limitText(input.ContactEmail, 255)
	input.ContactPhone = limitText(input.ContactPhone, 64)
	input.RegisteredAddress = limitText(input.RegisteredAddress, 1000)
	input.BankName = limitText(input.BankName, 200)
	input.BankAccount = limitText(input.BankAccount, 128)
	return input
}

func validateInvoiceProfileInput(input InvoiceProfileInput) error {
	if input.InvoiceTitle == "" || input.TaxpayerID == "" || input.ContactEmail == "" {
		return fmt.Errorf("invoice title, taxpayer ID and contact email are required")
	}
	if !strings.Contains(input.ContactEmail, "@") {
		return fmt.Errorf("contact email is invalid")
	}
	return nil
}

func validateInvoiceInput(input InvoiceRequestInput) error {
	if input.InvoiceTitle == "" || input.TaxpayerID == "" || input.ContactEmail == "" {
		return fmt.Errorf("invoice title, taxpayer ID and contact email are required")
	}
	if !strings.Contains(input.ContactEmail, "@") {
		return fmt.Errorf("contact email is invalid")
	}
	if len(input.OrderIDs) == 0 || len(input.OrderIDs) > 100 {
		return fmt.Errorf("select between 1 and 100 recharge orders")
	}
	seen := make(map[int64]bool, len(input.OrderIDs))
	for _, id := range input.OrderIDs {
		if id <= 0 || seen[id] {
			return fmt.Errorf("selected order IDs are invalid")
		}
		seen[id] = true
	}
	return nil
}
func limitText(value string, max int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) > max {
		return string([]rune(value)[:max])
	}
	return value
}
func parseInvoiceStatus(value string) (InvoiceStatus, bool) {
	status := InvoiceStatus(strings.ToUpper(strings.TrimSpace(value)))
	switch status {
	case InvoiceStatusPending, InvoiceStatusProcessing, InvoiceStatusIssued, InvoiceStatusRejected:
		return status, true
	}
	return "", false
}
func isAdminStatus(status InvoiceStatus) bool {
	return status == InvoiceStatusProcessing || status == InvoiceStatusRejected
}
func validateInvoiceDocumentName(value string) (string, string, string, error) {
	clean := filepath.Base(strings.TrimSpace(value))
	if clean == "." || clean == "" {
		return "", "", "", fmt.Errorf("invoice document is required")
	}
	extension := strings.ToLower(filepath.Ext(clean))
	allowed := map[string]string{".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
	mimeType, ok := allowed[extension]
	if !ok {
		return "", "", "", fmt.Errorf("invoice document must be PDF, PNG, or JPEG")
	}
	return limitText(clean, 255), extension, mimeType, nil
}
func randomHex(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func roundMoney(value float64) float64 { return math.Round(value*100) / 100 }
