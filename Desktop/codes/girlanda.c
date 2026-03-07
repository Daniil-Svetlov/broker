#define F_CPU 16000000UL
#include <avr/io.h>
#include <util/delay.h>

int main(void) 
{
    DDRB = 0xFF;       
    DDRC = 0x3F;       
    DDRD = 0xFB;          
    PORTD |= (1 << PD2); 

    uint8_t mode = 0;    
    uint32_t frame = 0;   
    uint8_t step = 0;     
    uint8_t grow = 1;     
    int8_t dir = 1;        
    uint8_t pos = 0;   
    uint8_t btn_lock = 0; 
    uint32_t one = 1;      

    while (1) 
    {
        switch (mode) 
        {
            case 0: 
                {
                    uint8_t order[] = {0, 18, 1, 17, 2, 16, 3, 15, 4, 14, 5, 13, 6, 12, 7, 11, 8, 10, 9};
                    if (grow) 
                    {
                        frame |= (one << order[step]);
                        step++;
                        if (step >= 19) grow = 0;
                    } else {
                        step--;
                        frame &= ~(one << order[step]);
                        if (step == 0) grow = 1;
                    }
                }
                break;

            case 1:
                frame = (one * 7) << pos;
                pos += dir;
                if (pos == 0 || pos == 16) dir = -dir;
                break;

    case 2:
{

    static uint16_t seed = 123; 
    seed = (uint16_t)(seed * 2053 + 13849); 
    uint8_t count = seed % 20; 
    frame = 0; 
    
    for (uint8_t j = 0; j < count; j++) 
    {
        seed = (uint16_t)(seed * 2053 + 13849);
        uint8_t r = seed % 19; 
        frame = frame | (one << r); 
    }
}
break;
        } 

        PORTB = (uint8_t)(frame & 0x3F);
        PORTC = (uint8_t)((frame >> 6) & 0x3F);
        uint8_t d_val = (PORTD & 0x04);
        if (frame & (one << 12)) d_val |= 0x01;
        if (frame & (one << 13)) d_val |= 0x02;
        if (frame & (one << 14)) d_val |= 0x08;
        if (frame & (one << 15)) d_val |= 0x10;
        if (frame & (one << 16)) d_val |= 0x20;
        if (frame & (one << 17)) d_val |= 0x40;
        if (frame & (one << 18)) d_val |= 0x80;
        PORTD = d_val;

        for (uint8_t i = 0; i < 20; i++) {
            if (!(PIND & (1 << PD2))) { 
                if (btn_lock == 0) {   
                    mode++;            
                    if (mode > 2) mode = 0;
                    frame = 0; step = 0; grow = 1; pos = 0; dir = 1;
                    btn_lock = 1;     
                }
            } else {
                btn_lock = 0;        
            }
            _delay_ms(5);          
        }
    }
}