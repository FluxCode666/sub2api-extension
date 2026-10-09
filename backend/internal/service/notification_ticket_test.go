package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTicketUserNotificationRecipientsUseOnlyOwnerEmail(t *testing.T) {
	for _, event := range []string{TicketAdminRepliedNotificationEvent, TicketStatusUpdatedNotificationEvent} {
		recipients, err := ticketUserNotificationRecipients(event, map[string]interface{}{
			"user_email": " owner@example.com ", "to": []string{"admin@example.com"},
		})
		require.NoError(t, err)
		require.Equal(t, []string{"owner@example.com"}, recipients)
		for _, email := range []interface{}{"", "invalid", "owner@example.com, other@example.com", "owner@example.com\r\nBcc: other@example.com", 17} {
			_, err = ticketUserNotificationRecipients(event, map[string]interface{}{"user_email": email})
			require.Error(t, err)
		}
	}
	for _, event := range []string{TicketCreatedNotificationEvent, TicketUserRepliedNotificationEvent, InvoiceApplicationNotificationEvent} {
		recipients, err := ticketUserNotificationRecipients(event, nil)
		require.NoError(t, err)
		require.Nil(t, recipients)
	}
}
