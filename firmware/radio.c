#include "board.h"
#include "radio.h"
#include "hci.h"
#include "hci_le.h"
#include "hci_tl.h"
#include "hci_const.h"
#include "bluenrg_gap.h"
#include "bluenrg_aci_const.h"
#include "bluenrg_gap_aci.h"
#include "bluenrg_gatt_aci.h"
#include "bluenrg_hal_aci.h"
#include "link_layer.h"
#include "sm.h"
#include "hci_tl_interface.h"
#include <string.h>

// UUID 41b00000-9235-4fe6-b605-2651fe3625a1 in BlueNRG wire order.
// The notification and command characteristics use 0001 and 0002.
static uint8_t uuid[16] = {0xa1,0x25,0x36,0xfe,0x51,0x26,0x05,0xb6,
                           0xe6,0x4f,0x35,0x92,0x00,0x00,0xb0,0x41};
static uint16_t service, stream, control;
static uint8_t pending_token;
static int initialized, subscribed, advertise;
// The Cube transport normally reads SPI inside the PE6 ISR. PC8 shares that
// IRQ, so service PE6 in the Comms thread, including while waiting for HCI
// command completions. There is only one owner of SPI3.
static int32_t init_bus(void *config) {
    int32_t status = HCI_TL_SPI_Init(config);
    CLEAR_BIT(EXTI->IMR1, GPIO_PIN_6);
    return status;
}

void magpad_hci_bus_init(void) {
    tHciIO io = {.Init=init_bus, .DeInit=HCI_TL_SPI_DeInit, .Reset=HCI_TL_SPI_Reset,
                 .Receive=HCI_TL_SPI_Receive, .Send=HCI_TL_SPI_Send, .GetTick=BSP_GetTick};
    hci_register_io_bus(&io);
}

uint32_t magpad_hci_tick(void) {
    if (HAL_GPIO_ReadPin(HCI_TL_SPI_IRQ_PORT, HCI_TL_SPI_IRQ_PIN) == GPIO_PIN_SET)
        hci_notify_asynch_evt(NULL);
    return HAL_GetTick();
}

static void event(void *packet) {
    hci_uart_pckt *header = packet;
    if (header->type != HCI_EVENT_PKT) return;
    hci_event_pckt *evt = (void *)header->data;
    if (evt->evt == EVT_DISCONN_COMPLETE) {
        subscribed = 0;
        pending_token = 0;
        advertise = 1;
    } else if (evt->evt == EVT_VENDOR) {
        evt_blue_aci *vendor = (void *)evt->data;
        if (vendor->ecode != EVT_BLUE_GATT_ATTRIBUTE_MODIFIED) return;
        evt_gatt_attr_modified_IDB05A1 *write = (void *)vendor->data;
        if (write->attr_handle == control+1 && write->offset == 0 && write->data_length == 1)
            pending_token = write->att_data[0];
        if (write->attr_handle == stream+2 && write->data_length == 2)
            subscribed = write->att_data[0] & 1;
    }
}

void radio_init(void) {
    __HAL_RCC_GPIOE_CLK_ENABLE();
    __HAL_RCC_GPIOD_CLK_ENABLE();
    __HAL_RCC_SYSCFG_CLK_ENABLE();
    hci_init(event, NULL);
    uint16_t gap, name, appearance;
    if (aci_gatt_init() ||
        aci_gap_init_IDB05A1(GAP_PERIPHERAL_ROLE_IDB05A1, 0, 6, &gap, &name, &appearance) ||
        aci_gatt_update_char_value(gap, name, 0, 6, (uint8_t *)"MagPad") ||
        aci_gatt_add_serv(UUID_TYPE_128, uuid, PRIMARY_SERVICE, 6, &service)) goto failed;
    uuid[12] = 1;
    if (aci_gatt_add_char(service, UUID_TYPE_128, uuid, 20, CHAR_PROP_NOTIFY | CHAR_PROP_READ,
                          ATTR_PERMISSION_NONE, GATT_NOTIFY_ATTRIBUTE_WRITE, 16, 0, &stream)) goto failed;
    uuid[12] = 2;
    if (aci_gatt_add_char(service, UUID_TYPE_128, uuid, 1, CHAR_PROP_WRITE,
                          ATTR_PERMISSION_NONE, GATT_NOTIFY_ATTRIBUTE_WRITE, 16, 0, &control)) goto failed;
    advertise = initialized = 1;
    return;
failed:
    board_print("ERROR BlueNRG init; UART available\r\n");
}

uint8_t radio_poll(void) {
    static uint32_t next_attempt;
    if (!initialized) return 0;
    magpad_hci_tick();
    hci_user_evt_proc();
    if (advertise && (int32_t)(HAL_GetTick()-next_attempt) >= 0) {
        const char name[] = {AD_TYPE_COMPLETE_LOCAL_NAME,'M','a','g','P','a','d'};
        advertise = aci_gap_set_discoverable(ADV_IND, 160, 240, STATIC_RANDOM_ADDR,
                    NO_WHITE_LIST_USE, sizeof name, name, 0, NULL, 12, 24) != 0;
        next_attempt = HAL_GetTick()+1000;
    }
    uint8_t token = pending_token;
    pending_token = 0;
    return token;
}

void radio_send(uint32_t seq, uint32_t tick, uint8_t token, uint8_t state,
                int16_t x, int16_t y, uint32_t dropped, uint32_t elapsed_us) {
    // 20 bytes fit the default ATT MTU. STM32 is little endian.
    static uint32_t tx_drops;
    if (!subscribed) return;
    uint8_t data[20] = {0};
    dropped += tx_drops;
    uint16_t usec = elapsed_us > UINT16_MAX ? UINT16_MAX : elapsed_us;
    memcpy(data, &seq, 4);
    memcpy(data+4, &tick, 4);
    data[8] = token;
    data[9] = state;
    memcpy(data+10, &x, 2);
    memcpy(data+12, &y, 2);
    memcpy(data+14, &dropped, 4);
    memcpy(data+18, &usec, 2);
    if (aci_gatt_update_char_value(service, stream, 0, sizeof data, data)) ++tx_drops;
}
