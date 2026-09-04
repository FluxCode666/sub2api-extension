package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"sub2api-extension/ent"
	"sub2api-extension/ent/invoicerequest"
)

// MaxFileAssetNoteLength limits the administrator note stored with a file
// record. Notes are metadata, so they are kept bounded to protect list/update
// requests while allowing ordinary operational context.
const MaxFileAssetNoteLength = 2000

var (
	ErrFileAssetNotFound    = errors.New("file asset not found")
	ErrFileAssetSource      = errors.New("unsupported file asset source")
	ErrFileAssetID          = errors.New("invalid file asset ID")
	ErrFileAssetNoteTooLong = errors.New("file asset note is too long")
)

// FileAsset is the common management view of every file uploaded through the
// extension. Images live in image_assets while issued invoice documents are
// indexed on invoice_requests; this type keeps those storage details out of
// the file management API.
type FileAsset struct {
	Source       string    `json:"source"`
	SourceID     int       `json:"source_id"`
	Name         string    `json:"name"`          // Deprecated alias for OriginalName.
	OriginalName string    `json:"original_name"` // Name supplied by the uploader.
	Note         string    `json:"note"`
	MimeType     string    `json:"mime_type"`
	Size         int64     `json:"size"`
	CreatedAt    time.Time `json:"created_at"`
}

// FileAssetService aggregates the two upload indexes used by the system.
// File bytes remain in the configured asset directory; this service only
// reads metadata needed by the admin file list.
type FileAssetService struct {
	client *ent.Client
}

func NewFileAssetService(client *ent.Client) *FileAssetService {
	return &FileAssetService{client: client}
}

func (s *FileAssetService) List(ctx context.Context) ([]FileAsset, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("file asset store is unavailable")
	}

	images, err := s.client.ImageAsset.Query().All(ctx)
	if err != nil {
		return nil, err
	}
	invoices, err := s.client.InvoiceRequest.Query().Where(invoicerequest.InvoiceFilePathNEQ("")).All(ctx)
	if err != nil {
		return nil, err
	}

	files := make([]FileAsset, 0, len(images)+len(invoices))
	for _, image := range images {
		files = append(files, FileAsset{
			Source:       "image",
			SourceID:     image.ID,
			Name:         image.OriginalName,
			OriginalName: image.OriginalName,
			Note:         image.Note,
			MimeType:     image.MimeType,
			Size:         image.Size,
			CreatedAt:    image.CreatedAt,
		})
	}
	for _, invoice := range invoices {
		createdAt := invoice.UpdatedAt
		if invoice.IssuedAt != nil {
			createdAt = *invoice.IssuedAt
		}
		name := strings.TrimSpace(invoice.InvoiceFileName)
		if name == "" {
			name = invoice.InvoiceFilePath
		}
		files = append(files, FileAsset{
			Source:       "invoice",
			SourceID:     invoice.ID,
			Name:         name,
			OriginalName: name,
			Note:         invoice.InvoiceFileNote,
			MimeType:     invoice.InvoiceFileMimeType,
			Size:         invoice.InvoiceFileSize,
			CreatedAt:    createdAt,
		})
	}

	sort.SliceStable(files, func(i, j int) bool {
		if files[i].CreatedAt.Equal(files[j].CreatedAt) {
			return files[i].SourceID > files[j].SourceID
		}
		return files[i].CreatedAt.After(files[j].CreatedAt)
	})
	return files, nil
}

// UpdateNote updates only the note belonging to one file record. The source
// discriminator is part of the resource identity so an image ID can never be
// accidentally applied to an invoice request (or vice versa).
func (s *FileAssetService) UpdateNote(ctx context.Context, source string, id int, note string) (*FileAsset, error) {
	if s == nil || s.client == nil {
		return nil, errors.New("file asset store is unavailable")
	}
	if id <= 0 {
		return nil, ErrFileAssetID
	}
	note = strings.TrimSpace(note)
	if len([]rune(note)) > MaxFileAssetNoteLength {
		return nil, ErrFileAssetNoteTooLong
	}

	switch strings.ToLower(strings.TrimSpace(source)) {
	case "image":
		asset, err := s.client.ImageAsset.Get(ctx, id)
		if ent.IsNotFound(err) {
			return nil, ErrFileAssetNotFound
		}
		if err != nil {
			return nil, err
		}
		updated, err := s.client.ImageAsset.UpdateOne(asset).SetNote(note).Save(ctx)
		if err != nil {
			return nil, err
		}
		return fileAssetFromImage(updated), nil
	case "invoice":
		request, err := s.client.InvoiceRequest.Get(ctx, id)
		if ent.IsNotFound(err) {
			return nil, ErrFileAssetNotFound
		}
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(request.InvoiceFilePath) == "" {
			return nil, ErrFileAssetNotFound
		}
		updated, err := s.client.InvoiceRequest.UpdateOne(request).SetInvoiceFileNote(note).Save(ctx)
		if err != nil {
			return nil, err
		}
		name := strings.TrimSpace(updated.InvoiceFileName)
		if name == "" {
			name = updated.InvoiceFilePath
		}
		createdAt := updated.UpdatedAt
		if updated.IssuedAt != nil {
			createdAt = *updated.IssuedAt
		}
		return &FileAsset{
			Source:       "invoice",
			SourceID:     updated.ID,
			Name:         name,
			OriginalName: name,
			Note:         updated.InvoiceFileNote,
			MimeType:     updated.InvoiceFileMimeType,
			Size:         updated.InvoiceFileSize,
			CreatedAt:    createdAt,
		}, nil
	default:
		return nil, ErrFileAssetSource
	}
}

func fileAssetFromImage(asset *ent.ImageAsset) *FileAsset {
	return &FileAsset{
		Source:       "image",
		SourceID:     asset.ID,
		Name:         asset.OriginalName,
		OriginalName: asset.OriginalName,
		Note:         asset.Note,
		MimeType:     asset.MimeType,
		Size:         asset.Size,
		CreatedAt:    asset.CreatedAt,
	}
}
