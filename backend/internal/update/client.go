package update

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"time"
)

type Job struct {
	ID        string    `json:"id"`
	Version   string    `json:"version"`
	Phase     string    `json:"phase"`
	Message   string    `json:"message"`
	StartedAt time.Time `json:"startedAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (j *Job) Active() bool {
	return j != nil && j.Phase != "succeeded" && j.Phase != "failed" && j.Phase != "rolled_back" && j.Phase != "rollback_failed"
}

type Status struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason,omitempty"`
	Job     *Job   `json:"job,omitempty"`
}

type UpdateRequest struct {
	Version string `json:"version"`
}

type Controller interface {
	Status(context.Context) Status
	Start(context.Context, string) (*Job, error)
}

type Client struct {
	socket string
	http   *http.Client
}

func NewClient(socket string) *Client {
	return &Client{socket: socket, http: &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		}},
	}}
}

func (c *Client) request(ctx context.Context, method, path string, body any, output any) error {
	if c.socket == "" {
		return errors.New("尚未启用更新服务，请按部署文档启用后重试")
	}
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://updater"+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return errors.New("更新服务暂不可用，请检查 aux-updater 容器")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		var failure struct {
			Message string `json:"message"`
		}
		if json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&failure) == nil && failure.Message != "" {
			return errors.New(failure.Message)
		}
		return errors.New("更新请求失败，请检查更新服务")
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(output)
}

func (c *Client) Status(ctx context.Context) Status {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var status Status
	if err := c.request(ctx, http.MethodGet, "/status", nil, &status); err != nil {
		return Status{Reason: err.Error()}
	}
	return status
}

func (c *Client) Start(ctx context.Context, version string) (*Job, error) {
	var job Job
	err := c.request(ctx, http.MethodPost, "/update", UpdateRequest{Version: version}, &job)
	return &job, err
}
